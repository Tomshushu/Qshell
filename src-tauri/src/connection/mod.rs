//! 连接协议与连接目标类型抽象层
//!
//! 将两个原本硬编码在 SSH/Linux 体系中的维度抽离：
//! - [`ConnectionProtocol`]：「用什么协议连接」（SSH / WinRM / Telnet / VNC ...）
//! - [`TargetType`]：「连接到什么类型的目标」（Linux / Windows / 网络设备 / Unix 小机 / BMC / 信创）
//!
//! ## 设计原则
//! 1. **现有功能不变**：所有未显式指定类型的服务器默认为 `(Linux, Ssh)`，
//!    其行为与抽象前完全一致——默认端口 22、默认用户 root、OS 探测命令相同。
//! 2. **仅新增不修改**：现有 `ssh` / `metrics` / `services` 等模块保持原样，
//!    只在需要按目标类型分发的入口（如 OS 探测）引入路由。
//! 3. **可扩展**：新增目标类型或协议只需在对应枚举追加变体并实现方法，
//!    无需改动既有 SSH 连接管理逻辑。

use serde::{Deserialize, Serialize};

// ============================================================================
// 连接目标类型
// ============================================================================

/// 连接目标类型
///
/// 决定：默认端口、默认用户名、OS 探测命令、可用工作区模块等「目标相关」行为。
/// 与 [`ConnectionProtocol`] 正交——例如 Windows 既可走 SSH，也可走 WinRM。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum TargetType {
    /// Linux 服务器（默认）
    #[default]
    Linux,
    /// Windows 服务器（OpenSSH / WinRM）
    Windows,
    /// 网络设备：交换机 / 路由器 / 防火墙
    Network,
    /// Unix 小机：AIX / HP-UX / Solaris
    Unix,
    /// 带外管理：BMC / iDRAC / iLO / KVM over IP
    Bmc,
    /// 串口通信（COM / tty）
    Serial,
    /// 信创：UOS / 麒麟 + 龙芯 / ARM
    Xinchuang,
    /// ESXi / vCenter：HTTPS REST 设备
    Esxi,
    /// Kubernetes 集群：API Server + Bearer Token（Phase 2-C）
    Kubernetes,
}


impl TargetType {
    /// 严格解析：未知值返回明确错误。
    /// 所有写入 / 校验入口必须使用此方法，避免新设备类型被静默退化成 Linux+SSH。
    pub fn parse(s: &str) -> Result<Self, String> {
        let normalized = s.trim().to_ascii_lowercase();
        TARGET_SPECS
            .iter()
            .find(|spec| spec.target.as_str() == normalized)
            .map(|spec| spec.target)
            .ok_or_else(|| {
                format!(
                    "未知的目标类型 '{}'，当前支持：{}",
                    s,
                    supported_target_names()
                )
            })
    }

    /// 宽松解析：仅用于读取历史数据（DB 旧行 / 旧导入文件），未知值回退 Linux。
    /// 写入与校验入口必须改用 [`TargetType::parse`]。
    pub fn from_str_lossy(s: &str) -> Self {
        Self::parse(s).unwrap_or(TargetType::Linux)
    }

    /// 转为数据库 / 前端使用的字符串。
    pub fn as_str(&self) -> &'static str {
        match self {
            TargetType::Linux => "linux",
            TargetType::Windows => "windows",
            TargetType::Network => "network",
            TargetType::Unix => "unix",
            TargetType::Bmc => "bmc",
            TargetType::Serial => "serial",
            TargetType::Xinchuang => "xinchuang",
            TargetType::Esxi => "esxi",
            TargetType::Kubernetes => "kubernetes",
        }
    }

    /// 默认端口（来自能力表 [`TARGET_SPECS`]，与协议默认端口协同）。
    pub fn default_port(&self) -> i32 {
        target_spec(*self).default_port
    }

    /// 默认用户名（来自能力表 [`TARGET_SPECS`]）。
    pub fn default_username(&self) -> &'static str {
        target_spec(*self).default_username
    }

    /// OS 探测命令。
    ///
    /// 输出格式约定为三段，以 `---SEP---` 分隔：
    /// ```text
    /// <release_content，含 ID= / PRETTY_NAME=>
    /// ---SEP---
    /// <arch>
    /// ---SEP---
    /// <kernel>
    /// ```
    ///
    /// - Linux / Unix / 信创 / 网络 / BMC：委托 [`crate::targets::linux::os_detect`]，
    ///   读取 `/etc/os-release` + `uname`，与原实现完全一致。
    /// - Windows：委托 [`crate::targets::windows::os_detect`]，
    ///   通过 cmd.exe 输出相同分隔格式，复用现有解析逻辑。
    pub fn os_detect_command(&self) -> String {
        match self {
            TargetType::Windows => crate::targets::windows::os_detect::os_detect_command(),
            TargetType::Serial => String::new(),
            _ => crate::targets::linux::os_detect::os_detect_command(),
        }
    }
}

// ============================================================================
// 连接协议
// ============================================================================

/// 连接协议
///
/// 决定：传输层实现（russh / WinRM / Telnet ...）、可用认证方式集合等「协议相关」行为。
/// 当前已接入 SSH、RDP 启动器、Telnet 与 Serial；WinRM/VNC 保留枚举用于兼容历史数据，
/// 但在真正实现传输层前不会出现在可选协议列表中。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum ConnectionProtocol {
    /// SSH 协议（基于 russh）
    #[default]
    Ssh,
    /// Windows 远程桌面（由系统 RDP 客户端启动）
    Rdp,
    /// 预留：Windows 远程管理（WinRM）
    Winrm,
    /// 预留：Telnet（网络设备 / 老旧系统）
    Telnet,
    /// 预留：VNC 远程桌面
    Vnc,
    /// 串口通信（由 serial 模块实现）
    Serial,
    /// BMC Redfish HTTPS 带外管理
    Redfish,
    /// 通用 HTTPS REST 设备（ESXi / vCenter / Proxmox，Phase 2-B 注册）
    Https,
    /// Kubernetes API Server（Bearer Token，Phase 2-C）
    K8s,
}

// ============================================================================
// 能力声明表（Phase 0：唯一真源）
// ============================================================================

/// 全部已知协议（含未实现的 WinRM/VNC，仅用于解析历史数据）。
pub const ALL_PROTOCOLS: &[ConnectionProtocol] = &[
    ConnectionProtocol::Ssh,
    ConnectionProtocol::Rdp,
    ConnectionProtocol::Winrm,
    ConnectionProtocol::Telnet,
    ConnectionProtocol::Vnc,
    ConnectionProtocol::Serial,
    ConnectionProtocol::Redfish,
    ConnectionProtocol::Https,
    ConnectionProtocol::K8s,
];

/// 目标能力位：描述该类型可复用哪些通用能力。
/// 前端 `src/services/connection-targets.tsx` 的 `capabilities` 与本表一一对应，
/// 两侧均有镜像矩阵单测，新增设备类型必须同步两处。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityFlags {
    /// 可走 SSH 连接池（SFTP / 代理 / known_hosts 的基础）
    pub ssh_backed: bool,
    /// 内嵌 xterm 终端会话
    pub terminal: bool,
    /// 系统指标采集与 HUD
    pub metrics: bool,
    /// 文件 / SFTP 模块
    pub files: bool,
    /// AI 只读探针
    pub probe: bool,
    /// 允许覆盖 TLS 证书校验（HTTPS 设备，决策 4 的泛化基础）
    pub tls_cert_override: bool,
    /// 需要 host / 端口（本地终端为 false）
    pub requires_host: bool,
}

const SSH_HOST_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: true,
    terminal: true,
    metrics: true,
    files: true,
    probe: true,
    tls_cert_override: false,
    requires_host: true,
};

const NETWORK_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: true,
    terminal: true,
    metrics: false,
    files: false,
    probe: false,
    tls_cert_override: false,
    requires_host: true,
};

const REDFISH_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: false,
    terminal: false,
    metrics: false,
    files: false,
    probe: false,
    tls_cert_override: true,
    requires_host: true,
};

/// 通用 HTTPS 设备：无 SSH / 终端 / 指标 / 文件 / 探针，允许覆盖 TLS 证书校验。
/// 与 `REDFISH_CAPS` 当前取值相同但语义独立——Redfish 只是第一个落地样板，
/// 后续 ESXi / vCenter / Proxmox 不应依赖 BMC 的能力常量。
const HTTPS_DEVICE_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: false,
    terminal: false,
    metrics: false,
    files: false,
    probe: false,
    tls_cert_override: true,
    requires_host: true,
};

/// Kubernetes API Server：无 SSH / 终端 / 指标 / 文件 / 探针，允许覆盖 TLS 校验。
const K8S_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: false,
    terminal: false,
    metrics: false,
    files: false,
    probe: false,
    tls_cert_override: true,
    requires_host: true,
};

const SERIAL_CAPS: CapabilityFlags = CapabilityFlags {
    ssh_backed: false,
    terminal: true,
    metrics: false,
    files: false,
    probe: false,
    tls_cert_override: false,
    requires_host: false,
};

/// 单个目标类型的完整规格：允许协议、主协议、默认值、能力位。
#[derive(Debug, Clone, Copy)]
pub struct TargetSpec {
    pub target: TargetType,
    pub protocols: &'static [ConnectionProtocol],
    /// 协议非法 / 历史数据清洗时回退到的主协议（与前端 supportedProtocols[0] 一致）
    pub primary_protocol: ConnectionProtocol,
    pub default_port: i32,
    pub default_username: &'static str,
    pub capabilities: CapabilityFlags,
}

/// 后端唯一真源：允许矩阵、默认端口/用户名、能力位、迁移白名单全部由此派生。
pub const TARGET_SPECS: &[TargetSpec] = &[
    TargetSpec {
        target: TargetType::Linux,
        protocols: &[ConnectionProtocol::Ssh],
        primary_protocol: ConnectionProtocol::Ssh,
        default_port: 22,
        default_username: "root",
        capabilities: SSH_HOST_CAPS,
    },
    TargetSpec {
        target: TargetType::Windows,
        protocols: &[ConnectionProtocol::Rdp, ConnectionProtocol::Ssh],
        primary_protocol: ConnectionProtocol::Rdp,
        default_port: 3389,
        default_username: "Administrator",
        capabilities: SSH_HOST_CAPS,
    },
    TargetSpec {
        target: TargetType::Network,
        protocols: &[ConnectionProtocol::Ssh, ConnectionProtocol::Telnet],
        primary_protocol: ConnectionProtocol::Ssh,
        default_port: 22,
        default_username: "admin",
        capabilities: NETWORK_CAPS,
    },
    TargetSpec {
        target: TargetType::Unix,
        protocols: &[ConnectionProtocol::Ssh],
        primary_protocol: ConnectionProtocol::Ssh,
        default_port: 22,
        default_username: "root",
        capabilities: SSH_HOST_CAPS,
    },
    TargetSpec {
        target: TargetType::Bmc,
        protocols: &[ConnectionProtocol::Redfish],
        primary_protocol: ConnectionProtocol::Redfish,
        default_port: 443,
        default_username: "admin",
        capabilities: REDFISH_CAPS,
    },
    TargetSpec {
        target: TargetType::Serial,
        protocols: &[ConnectionProtocol::Serial],
        primary_protocol: ConnectionProtocol::Serial,
        default_port: 115200,
        default_username: "",
        capabilities: SERIAL_CAPS,
    },
    TargetSpec {
        target: TargetType::Xinchuang,
        protocols: &[ConnectionProtocol::Ssh],
        primary_protocol: ConnectionProtocol::Ssh,
        default_port: 22,
        default_username: "root",
        capabilities: SSH_HOST_CAPS,
    },
    TargetSpec {
        target: TargetType::Esxi,
        protocols: &[ConnectionProtocol::Https],
        primary_protocol: ConnectionProtocol::Https,
        default_port: 443,
        default_username: "root",
        capabilities: HTTPS_DEVICE_CAPS,
    },
    TargetSpec {
        target: TargetType::Kubernetes,
        protocols: &[ConnectionProtocol::K8s],
        primary_protocol: ConnectionProtocol::K8s,
        default_port: 6443,
        default_username: "",
        capabilities: K8S_CAPS,
    },
];

pub fn target_spec(target: TargetType) -> &'static TargetSpec {
    TARGET_SPECS
        .iter()
        .find(|spec| spec.target == target)
        .expect("TARGET_SPECS 必须覆盖所有 TargetType 变体")
}

pub fn allowed_protocols(target: TargetType) -> &'static [ConnectionProtocol] {
    target_spec(target).protocols
}

pub fn is_protocol_allowed(target: TargetType, protocol: ConnectionProtocol) -> bool {
    allowed_protocols(target).contains(&protocol)
}

pub fn primary_protocol(target: TargetType) -> ConnectionProtocol {
    target_spec(target).primary_protocol
}

pub fn capabilities(target: TargetType) -> &'static CapabilityFlags {
    &target_spec(target).capabilities
}

/// IPC 能力守卫 / 查询用的能力键，与 `CapabilityFlags` 字段一一对应。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityKey {
    SshBacked,
    Terminal,
    Metrics,
    Files,
    Probe,
    TlsCertOverride,
    RequiresHost,
}

impl CapabilityKey {
    pub const ALL: [CapabilityKey; 7] = [
        CapabilityKey::SshBacked,
        CapabilityKey::Terminal,
        CapabilityKey::Metrics,
        CapabilityKey::Files,
        CapabilityKey::Probe,
        CapabilityKey::TlsCertOverride,
        CapabilityKey::RequiresHost,
    ];

    /// 键名与前端 `TargetCapabilities` 保持一致（camelCase）。
    pub fn as_str(self) -> &'static str {
        match self {
            CapabilityKey::SshBacked => "sshBacked",
            CapabilityKey::Terminal => "terminal",
            CapabilityKey::Metrics => "metrics",
            CapabilityKey::Files => "files",
            CapabilityKey::Probe => "probe",
            CapabilityKey::TlsCertOverride => "tlsCertOverride",
            CapabilityKey::RequiresHost => "requiresHost",
        }
    }

    /// 解析 IPC / 前端传入的能力键名，同时接受 camelCase 与 snake_case。
    /// 未知键返回明确错误，避免拼写错误被当作 false 静默放行或拒绝。
    pub fn parse(s: &str) -> Result<Self, String> {
        let normalized = s.trim().to_ascii_lowercase().replace('_', "");
        Self::ALL
            .iter()
            .copied()
            .find(|key| key.as_str().to_ascii_lowercase() == normalized)
            .ok_or_else(|| {
                format!(
                    "未知的能力位 '{}'，当前支持：{}",
                    s,
                    Self::ALL
                        .iter()
                        .map(|key| key.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })
    }
}

pub fn has_capability(target: TargetType, key: CapabilityKey) -> bool {
    let caps = capabilities(target);
    match key {
        CapabilityKey::SshBacked => caps.ssh_backed,
        CapabilityKey::Terminal => caps.terminal,
        CapabilityKey::Metrics => caps.metrics,
        CapabilityKey::Files => caps.files,
        CapabilityKey::Probe => caps.probe,
        CapabilityKey::TlsCertOverride => caps.tls_cert_override,
        CapabilityKey::RequiresHost => caps.requires_host,
    }
}

/// 从 DB 的 `target_type` 字符串解析能力位（宽松解析，与 `validate_target_protocol` 一致）。
pub fn server_capabilities(target_type: &str) -> &'static CapabilityFlags {
    capabilities(TargetType::from_str_lossy(target_type))
}

/// 生成供 IPC 返回的能力快照。纯函数，便于单测与前端镜像矩阵对照。
pub fn capability_snapshot(target_type: &str) -> serde_json::Value {
    let target = TargetType::from_str_lossy(target_type);
    let mut map = serde_json::Map::new();
    for key in CapabilityKey::ALL {
        map.insert(
            key.as_str().to_string(),
            serde_json::Value::Bool(has_capability(target, key)),
        );
    }
    map.insert(
        "targetType".to_string(),
        serde_json::Value::String(target.as_str().to_string()),
    );
    serde_json::Value::Object(map)
}

/// 当前已实现的协议集合（由能力表派生；WinRM/VNC 因未出现在任何目标里而被排除）。
pub fn implemented_protocols() -> Vec<ConnectionProtocol> {
    let mut result: Vec<ConnectionProtocol> = Vec::new();
    for spec in TARGET_SPECS {
        for proto in spec.protocols {
            if !result.contains(proto) {
                result.push(*proto);
            }
        }
    }
    result
}

pub fn supported_target_names() -> String {
    TARGET_SPECS
        .iter()
        .map(|spec| spec.target.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// 启动迁移用：给定 target/protocol，返回应改写成的协议；None 表示无需改写。
/// `db::migrate_servers_table` 的清洗循环与本函数共用同一张能力表。
pub fn migration_protocol_override(target_type: &str, protocol: &str) -> Option<&'static str> {
    let target = TargetType::from_str_lossy(target_type);
    let spec = target_spec(target);
    let normalized = protocol.trim().to_ascii_lowercase();
    if spec.protocols.iter().any(|p| p.as_str() == normalized) {
        None
    } else {
        Some(spec.primary_protocol.as_str())
    }
}

/// 协议允许的认证方式（Phase 0：把「非 SSH 一刀切强制密码」改为能力表驱动）。
///
/// 现有协议行为与重构前完全一致：SSH 由连接层自行处理认证方式，其余只允许密码。
/// 未来的 WinRM / K8s / ESXi 等新协议可在此声明 token / credentialConfig，
/// 无需再改 `servers_add` / `servers_update` 的校验逻辑。
pub const PROTOCOL_AUTH: &[(ConnectionProtocol, &[&str])] = &[
    (ConnectionProtocol::Ssh, &["password", "privateKey", "sshAgent", "certificate"]),
    (ConnectionProtocol::Rdp, &["password"]),
    (ConnectionProtocol::Winrm, &["password", "credentialConfig"]),
    (ConnectionProtocol::Telnet, &["password"]),
    (ConnectionProtocol::Vnc, &["password"]),
    (ConnectionProtocol::Serial, &["password"]),
    (ConnectionProtocol::Redfish, &["password"]),
    (ConnectionProtocol::Https, &["password", "credentialConfig"]),
    (ConnectionProtocol::K8s, &["password", "credentialConfig"]),
];

pub fn allowed_auth_types(protocol: ConnectionProtocol) -> &'static [&'static str] {
    PROTOCOL_AUTH
        .iter()
        .find(|(proto, _)| *proto == protocol)
        .map(|(_, auth)| *auth)
        .unwrap_or(&["password"])
}

pub fn is_auth_allowed(protocol: ConnectionProtocol, auth_type: &str) -> bool {
    // 历史行为：SSH 侧认证方式由连接层校验，此处不额外限制，避免误拒绝旧数据
    if protocol == ConnectionProtocol::Ssh {
        return true;
    }
    allowed_auth_types(protocol)
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(auth_type))
}

/// 规范化 protocols JSON 数组（Phase 0：恢复多协议语义）。
///
/// - 只保留该目标允许且已实现的协议，过滤未知/非法值；
/// - 去重并保持调用方顺序；
/// - 始终包含当前主协议（主协议缺失时插到首位）；
/// - 解析失败或空数组回退为单元素主协议。
///
/// 现有前端始终只传单元素数组，因此现有数据的行为完全不变；
/// 数据层先具备多协议能力，Phase 1 一台设备多协议时无需再改 DB。
pub fn normalize_protocols(
    raw: Option<&str>,
    target: TargetType,
    primary: ConnectionProtocol,
) -> String {
    // 主协议同样要过合法性校验：启动迁移可能从历史行解析出 winrm / vnc
    // 这类「已知但未实现」的协议，直接插到首位会把非法值写回 DB。
    let primary = if primary.is_implemented() && is_protocol_allowed(target, primary) {
        primary
    } else {
        primary_protocol(target)
    };
    let mut list: Vec<String> = Vec::new();
    if let Some(raw) = raw {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(raw) {
            for item in items {
                if let Some(name) = item.as_str() {
                    if let Ok(proto) = ConnectionProtocol::parse(name) {
                        let normalized = proto.as_str().to_string();
                        if is_protocol_allowed(target, proto)
                            && proto.is_implemented()
                            && !list.contains(&normalized)
                        {
                            list.push(normalized);
                        }
                    }
                }
            }
        }
    }
    let primary_name = primary.as_str().to_string();
    if !list.contains(&primary_name) {
        list.insert(0, primary_name);
    }
    serde_json::to_string(&list)
        .unwrap_or_else(|_| serde_json::to_string(&vec![primary.as_str()]).unwrap_or_default())
}

impl ConnectionProtocol {
    /// 严格解析：未知值返回明确错误；WinRM/VNC 是已知但未实现的协议，
    /// 因此可以解析成功，但会被 [`ConnectionProtocol::is_implemented`] 拒绝。
    pub fn parse(s: &str) -> Result<Self, String> {
        let normalized = s.trim().to_ascii_lowercase();
        ALL_PROTOCOLS
            .iter()
            .find(|proto| proto.as_str() == normalized)
            .copied()
            .ok_or_else(|| {
                format!(
                    "未知的连接协议 '{}'，当前支持：{}",
                    s,
                    ALL_PROTOCOLS
                        .iter()
                        .map(|p| p.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            })
    }

    /// 宽松解析：仅用于读取历史数据，未知值回退 SSH。
    pub fn from_str_lossy(s: &str) -> Self {
        Self::parse(s).unwrap_or(ConnectionProtocol::Ssh)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ConnectionProtocol::Ssh => "ssh",
            ConnectionProtocol::Rdp => "rdp",
            ConnectionProtocol::Winrm => "winrm",
            ConnectionProtocol::Telnet => "telnet",
            ConnectionProtocol::Vnc => "vnc",
            ConnectionProtocol::Serial => "serial",
            ConnectionProtocol::Redfish => "redfish",
            ConnectionProtocol::Https => "https",
            ConnectionProtocol::K8s => "k8s",
        }
    }

    /// 协议默认端口。
    pub fn default_port(&self) -> i32 {
        match self {
            ConnectionProtocol::Ssh => 22,
            ConnectionProtocol::Rdp => 3389,
            ConnectionProtocol::Winrm => 5985,
            ConnectionProtocol::Telnet => 23,
            ConnectionProtocol::Vnc => 5900,
            ConnectionProtocol::Serial => 115200,
            ConnectionProtocol::Redfish => 443,
            ConnectionProtocol::Https => 443,
            ConnectionProtocol::K8s => 6443,
        }
    }

    /// 当前版本真正具备传输层实现的协议（由能力表派生）。
    /// WinRM/VNC 仍保留枚举以兼容历史数据，但未出现在任何目标的能力表中。
    pub fn is_implemented(&self) -> bool {
        implemented_protocols().contains(self)
    }
}

/// 校验目标类型与协议的组合，避免 UI 选项与后端行为不一致。
/// 返回可直接展示给用户的错误信息。
///
/// 这里必须用宽松解析：本函数同时被连接、批量探测、测试连接、servers_update
/// 的后台运行时字段更新以及旧备份导入调用；历史库里存在空串 / 未知 target_type
/// 或 protocol 的行，严格解析会让这些旧资产直接报错、后台更新静默丢弃。
/// 严格解析由 `TargetType::parse` / `ConnectionProtocol::parse` 单独提供。
pub fn validate_target_protocol(target_type: &str, protocol: &str) -> Result<(), String> {
    let target = TargetType::from_str_lossy(target_type);
    let proto = ConnectionProtocol::from_str_lossy(protocol);
    let normalized = protocol.trim().to_ascii_lowercase();

    if !proto.is_implemented() {
        return Err(format!("协议 {} 当前尚未实现，请选择已支持的协议", normalized));
    }

    if is_protocol_allowed(target, proto) {
        Ok(())
    } else {
        Err(format!(
            "目标类型 {} 不支持协议 {}",
            target.as_str(),
            proto.as_str()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 与前端 `src/services/connection-targets.test.ts` 的镜像矩阵。
    /// caps 顺序：ssh_backed, terminal, metrics, files, probe, tls_cert_override, requires_host。
    /// 两侧同时断言（含能力位），任何一侧新增/修改设备类型都必须同步另一侧。
    const FRONTEND_MIRROR: &[(&str, &[&str], &str, i32, &str, [bool; 7])] = &[
        ("linux", &["ssh"], "ssh", 22, "root", [true, true, true, true, true, false, true]),
        ("windows", &["rdp", "ssh"], "rdp", 3389, "Administrator", [true, true, true, true, true, false, true]),
        ("network", &["ssh", "telnet"], "ssh", 22, "admin", [true, true, false, false, false, false, true]),
        ("unix", &["ssh"], "ssh", 22, "root", [true, true, true, true, true, false, true]),
        ("bmc", &["redfish"], "redfish", 443, "admin", [false, false, false, false, false, true, true]),
        ("serial", &["serial"], "serial", 115200, "", [false, true, false, false, false, false, false]),
        ("xinchuang", &["ssh"], "ssh", 22, "root", [true, true, true, true, true, false, true]),
        ("esxi", &["https"], "https", 443, "root", [false, false, false, false, false, true, true]),
        ("kubernetes", &["k8s"], "k8s", 6443, "", [false, false, false, false, false, true, true]),
    ];

    #[test]
    fn protocol_round_trip_includes_frontend_protocols() {
        for value in ["ssh", "rdp", "telnet", "serial", "redfish", "winrm", "vnc"] {
            let parsed = ConnectionProtocol::from_str_lossy(value);
            assert_eq!(parsed.as_str(), value);
        }
    }

    #[test]
    fn target_protocol_matrix_is_strict() {
        assert!(validate_target_protocol("windows", "ssh").is_ok());
        assert!(validate_target_protocol("windows", "rdp").is_ok());
        assert!(validate_target_protocol("network", "telnet").is_ok());
        assert!(validate_target_protocol("bmc", "redfish").is_ok());
        assert!(validate_target_protocol("linux", "rdp").is_err());
        assert!(validate_target_protocol("linux", "vnc").is_err());
        assert!(validate_target_protocol("serial", "ssh").is_err());
    }

    #[test]
    fn target_defaults_match_primary_protocols() {
        assert_eq!(TargetType::Linux.default_port(), 22);
        assert_eq!(TargetType::Windows.default_port(), 3389);
        assert_eq!(TargetType::Bmc.default_port(), 443);
        assert_eq!(TargetType::Serial.default_port(), 115200);
    }

    #[test]
    fn capability_table_matches_frontend_mirror() {
        assert_eq!(TARGET_SPECS.len(), FRONTEND_MIRROR.len());
        for (name, protocols, primary, port, username, caps) in FRONTEND_MIRROR {
            let target = TargetType::parse(name).unwrap_or_else(|e| panic!("{}", e));
            let spec = target_spec(target);
            let actual: Vec<&str> = spec.protocols.iter().map(|p| p.as_str()).collect();
            assert_eq!(&actual, protocols, "{} 协议矩阵", name);
            assert_eq!(spec.primary_protocol.as_str(), *primary, "{} 主协议", name);
            assert_eq!(spec.default_port, *port, "{} 默认端口", name);
            assert_eq!(spec.default_username, *username, "{} 默认用户名", name);
            let actual_caps = [
                spec.capabilities.ssh_backed,
                spec.capabilities.terminal,
                spec.capabilities.metrics,
                spec.capabilities.files,
                spec.capabilities.probe,
                spec.capabilities.tls_cert_override,
                spec.capabilities.requires_host,
            ];
            assert_eq!(&actual_caps, caps, "{} 能力位", name);
        }
    }

    #[test]
    fn capability_table_covers_every_enum_variant_once() {
        let variants = [
            TargetType::Linux,
            TargetType::Windows,
            TargetType::Network,
            TargetType::Unix,
            TargetType::Bmc,
            TargetType::Serial,
            TargetType::Xinchuang,
            TargetType::Esxi,
            TargetType::Kubernetes,
        ];
        assert_eq!(TARGET_SPECS.len(), variants.len());
        for variant in variants {
            assert_eq!(
                TARGET_SPECS.iter().filter(|s| s.target == variant).count(),
                1,
                "{} 在能力表中应恰好出现一次",
                variant.as_str()
            );
        }
        assert_eq!(ALL_PROTOCOLS.len(), 9);
    }

    #[test]
    fn strict_parse_rejects_unknown_values_but_validation_stays_lenient() {
        assert!(TargetType::parse("k8s").is_err());
        assert!(TargetType::parse("mainframe").is_err());
        assert!(ConnectionProtocol::parse("mosh").is_err());
        // Phase 2-B-1 起 esxi / https 已是已注册值，不再属于「未知类型」样本
        assert!(TargetType::parse("esxi").is_ok());
        assert!(ConnectionProtocol::parse("https").is_ok());
        // 校验入口保持宽松：未知类型 / 空串 / 未知协议回退 Linux+SSH，
        // 旧资产仍可连接、可保存，后台运行时更新不会被静默丢弃。
        assert!(validate_target_protocol("k8s", "ssh").is_ok());
        assert!(validate_target_protocol("linux", "mosh").is_ok());
        assert!(validate_target_protocol("", "").is_ok());
        // 但非法组合与未实现协议仍然拒绝
        assert!(validate_target_protocol("linux", "rdp").is_err());
        assert!(validate_target_protocol("linux", "vnc").is_err());
        // 读取历史数据仍兼容
        assert_eq!(TargetType::from_str_lossy("k8s"), TargetType::Linux);
        assert_eq!(
            ConnectionProtocol::from_str_lossy("mosh"),
            ConnectionProtocol::Ssh
        );
    }

    #[test]
    fn capability_flags_describe_non_ssh_devices() {
        let bmc = capabilities(TargetType::Bmc);
        assert!(!bmc.ssh_backed);
        assert!(!bmc.metrics);
        assert!(!bmc.files);
        assert!(!bmc.probe);
        assert!(bmc.tls_cert_override);

        let network = capabilities(TargetType::Network);
        assert!(network.terminal);
        assert!(!network.metrics);
        assert!(!network.files);

        let serial = capabilities(TargetType::Serial);
        assert!(serial.terminal);
        assert!(!serial.requires_host);
        assert!(!serial.tls_cert_override);

        let linux = capabilities(TargetType::Linux);
        assert!(linux.ssh_backed && linux.metrics && linux.files && linux.probe);
    }

    #[test]
    fn implemented_protocols_exclude_placeholder_protocols() {
        let implemented = implemented_protocols();
        assert!(implemented.contains(&ConnectionProtocol::Redfish));
        assert!(implemented.contains(&ConnectionProtocol::Telnet));
        assert!(!implemented.contains(&ConnectionProtocol::Winrm));
        assert!(!implemented.contains(&ConnectionProtocol::Vnc));
    }

    #[test]
    fn migration_override_is_derived_from_capability_table() {
        assert_eq!(migration_protocol_override("windows", "winrm"), Some("rdp"));
        assert_eq!(migration_protocol_override("windows", "ssh"), None);
        assert_eq!(migration_protocol_override("linux", "vnc"), Some("ssh"));
        assert_eq!(migration_protocol_override("network", "telnet"), None);
        assert_eq!(migration_protocol_override("network", "rdp"), Some("ssh"));
        assert_eq!(migration_protocol_override("bmc", "ssh"), Some("redfish"));
        assert_eq!(migration_protocol_override("serial", "ssh"), Some("serial"));
        assert_eq!(migration_protocol_override("serial", "serial"), None);
    }

    #[test]
    fn auth_rules_keep_existing_protocol_behavior() {
        // 历史行为：SSH 不限认证方式，其余只允许 password
        assert!(is_auth_allowed(ConnectionProtocol::Ssh, "privateKey"));
        assert!(is_auth_allowed(ConnectionProtocol::Ssh, "certificate"));
        assert!(is_auth_allowed(ConnectionProtocol::Rdp, "password"));
        assert!(!is_auth_allowed(ConnectionProtocol::Rdp, "privateKey"));
        assert!(!is_auth_allowed(ConnectionProtocol::Redfish, "sshAgent"));
        assert!(!is_auth_allowed(ConnectionProtocol::Telnet, "certificate"));
        // 未来协议可在能力表中声明新认证方式，无需改 DB 校验逻辑
        assert!(is_auth_allowed(ConnectionProtocol::Winrm, "credentialConfig"));
    }

    #[test]
    fn normalize_protocols_keeps_single_protocol_for_existing_clients() {
        let result = normalize_protocols(None, TargetType::Linux, ConnectionProtocol::Ssh);
        assert_eq!(result, r#"["ssh"]"#);
        let result = normalize_protocols(
            Some(r#"["rdp"]"#),
            TargetType::Windows,
            ConnectionProtocol::Rdp,
        );
        assert_eq!(result, r#"["rdp"]"#);
    }

    #[test]
    fn normalize_protocols_supports_multiple_allowed_protocols() {
        let result = normalize_protocols(
            Some(r#"["ssh","rdp"]"#),
            TargetType::Windows,
            ConnectionProtocol::Rdp,
        );
        assert_eq!(result, r#"["ssh","rdp"]"#);
        // 主协议缺失时自动补到首位
        let result = normalize_protocols(
            Some(r#"["ssh"]"#),
            TargetType::Windows,
            ConnectionProtocol::Rdp,
        );
        assert_eq!(result, r#"["rdp","ssh"]"#);
    }

    #[test]
    fn normalize_protocols_filters_illegal_and_duplicate_values() {
        let result = normalize_protocols(
            Some(r#"["ssh","rdp","mosh","ssh"]"#),
            TargetType::Network,
            ConnectionProtocol::Ssh,
        );
        // network 只允许 ssh / telnet；rdp 与未知协议被过滤，重复项去重
        assert_eq!(result, r#"["ssh"]"#);
        let result = normalize_protocols(
            Some(r#"["telnet","ssh","telnet"]"#),
            TargetType::Network,
            ConnectionProtocol::Ssh,
        );
        assert_eq!(result, r#"["telnet","ssh"]"#);
        let result = normalize_protocols(
            Some("not-json"),
            TargetType::Linux,
            ConnectionProtocol::Ssh,
        );
        assert_eq!(result, r#"["ssh"]"#);
    }

    #[test]
    fn normalize_protocols_rejects_unimplemented_primary() {
        // 启动迁移可能从历史行解析出 winrm / vnc（已知但未实现），
        // 不能让它们作为主协议被插回 protocols 列。
        let result = normalize_protocols(None, TargetType::Windows, ConnectionProtocol::Winrm);
        assert_eq!(result, r#"["rdp"]"#);
        let result = normalize_protocols(
            Some(r#"["ssh"]"#),
            TargetType::Linux,
            ConnectionProtocol::Vnc,
        );
        assert_eq!(result, r#"["ssh"]"#);
    }

    /// Phase 3-A/B：历史 7 种类型的能力位条件必须与重构前的字面量判断逐类型等价。
    /// 生产路径（`ssh_connect` / `ssh_test_connect_with_config` / `ssh_detect_os_info`）
    /// 与 IPC 守卫统一走 `has_capability`，此断言直接覆盖该表达式。
    ///
    /// Phase 2-B-1：新增 ESXi 这类「无 metrics、但也不是 Network/Bmc」的 HTTPS 设备后，
    /// 旧字面量 `!= Network && != Bmc` 不再等价于能力位条件（会把 ESXi 误判为需要
    /// 跑 SSH OS 探测）。因此等价断言固定锁定历史类型，新类型以能力位为唯一真源。
    #[test]
    fn capability_driven_os_probe_matches_legacy_condition() {
        const LEGACY_TARGETS: [TargetType; 7] = [
            TargetType::Linux,
            TargetType::Windows,
            TargetType::Network,
            TargetType::Unix,
            TargetType::Bmc,
            TargetType::Serial,
            TargetType::Xinchuang,
        ];
        for spec in TARGET_SPECS {
            let t = spec.target;
            let via_caps = has_capability(t, CapabilityKey::Metrics) || t == TargetType::Serial;
            let via_caps_network_like =
                !has_capability(t, CapabilityKey::Metrics) && t != TargetType::Serial;
            assert_eq!(via_caps, !via_caps_network_like, "{} 两处条件互补", t.as_str());

            if LEGACY_TARGETS.contains(&t) {
                let legacy_deferred = t != TargetType::Network && t != TargetType::Bmc;
                let legacy_network_like = t == TargetType::Network || t == TargetType::Bmc;
                assert_eq!(via_caps, legacy_deferred, "{} 延迟 OS 探测", t.as_str());
                assert_eq!(
                    via_caps_network_like, legacy_network_like,
                    "{} 网络设备快捷返回",
                    t.as_str()
                );
            }
        }
        // HTTPS 设备明确不跑 SSH OS 探测：这是旧字面量条件做不到的新语义
        assert!(!has_capability(TargetType::Esxi, CapabilityKey::Metrics));
        assert!(!has_capability(TargetType::Esxi, CapabilityKey::SshBacked));
        // 未知 target_type 宽松回退 Linux，仍与旧逻辑一致
        let unknown = TargetType::from_str_lossy("k8s");
        assert!(has_capability(unknown, CapabilityKey::Metrics) || unknown == TargetType::Serial);
    }

    /// Phase 3-B：统一查询入口逐类型 × 逐能力位与前端镜像矩阵一致。
    #[test]
    fn capability_query_matrix_matches_frontend_mirror() {
        for (name, _, _, _, _, caps) in FRONTEND_MIRROR {
            let target = TargetType::parse(name).unwrap();
            for (index, key) in CapabilityKey::ALL.iter().enumerate() {
                assert_eq!(
                    has_capability(target, *key),
                    caps[index],
                    "{} 的 {} 能力位",
                    name,
                    key.as_str()
                );
            }
        }
        // IPC 的字符串入参与 TargetType 解析结果一致
        for (name, _, _, _, _, caps) in FRONTEND_MIRROR {
            for (index, key) in CapabilityKey::ALL.iter().enumerate() {
                assert_eq!(
                    has_capability(TargetType::from_str_lossy(name), *key),
                    caps[index]
                );
            }
        }
    }

    #[test]
    fn capability_key_parse_round_trip() {
        for key in CapabilityKey::ALL {
            assert_eq!(CapabilityKey::parse(key.as_str()).unwrap(), key);
        }
        let snake_cases = [
            ("ssh_backed", CapabilityKey::SshBacked),
            ("terminal", CapabilityKey::Terminal),
            ("metrics", CapabilityKey::Metrics),
            ("files", CapabilityKey::Files),
            ("probe", CapabilityKey::Probe),
            ("tls_cert_override", CapabilityKey::TlsCertOverride),
            ("requires_host", CapabilityKey::RequiresHost),
        ];
        for (name, key) in snake_cases {
            assert_eq!(CapabilityKey::parse(name).unwrap(), key);
        }
        assert_eq!(
            CapabilityKey::parse(" Metrics ").unwrap(),
            CapabilityKey::Metrics
        );
        assert!(CapabilityKey::parse("unknownCap").is_err());
        assert!(CapabilityKey::parse("").is_err());
    }

    /// Phase 3-B：IPC 快照的键名 / 值必须与前端 `TargetCapabilities` 形状一致。
    #[test]
    fn capability_snapshot_exposes_frontend_shape() {
        let expected_keys = [
            "sshBacked",
            "terminal",
            "metrics",
            "files",
            "probe",
            "tlsCertOverride",
            "requiresHost",
        ];
        for (name, _, _, _, _, caps) in FRONTEND_MIRROR {
            let value = capability_snapshot(name);
            let obj = value.as_object().expect("能力快照必须是对象");
            assert_eq!(obj.len(), expected_keys.len() + 1, "{} 键数量", name);
            assert_eq!(
                obj.get("targetType").and_then(|v| v.as_str()),
                Some(*name),
                "{} targetType",
                name
            );
            for (index, key) in expected_keys.iter().enumerate() {
                assert_eq!(
                    obj.get(*key),
                    Some(&serde_json::Value::Bool(caps[index])),
                    "{} 的 {}",
                    name,
                    key
                );
            }
        }
        // 未知类型 / 大小写 / 前后空格：宽松回退，但快照形状不变
        for raw in ["k8s", " LINUX ", "WINDOWS"] {
            let value = capability_snapshot(raw);
            let obj = value.as_object().expect("能力快照必须是对象");
            assert_eq!(obj.len(), expected_keys.len() + 1);
            assert!(expected_keys.iter().all(|key| obj.contains_key(*key)));
            assert!(obj.get("targetType").is_some());
        }
    }

    /// Phase 2-B-1：ESXi / HTTPS 的注册契约。
    /// 本批只登记规格与能力位，传输层与 UI 尚未接线；前端 `enabled` 必须保持 false，
    /// 由 `connection-targets.test.ts` 的启用列表断言同步锁定。
    #[test]
    fn esxi_https_registration_is_table_driven() {
        assert_eq!(TargetType::parse("esxi").unwrap(), TargetType::Esxi);
        assert_eq!(TargetType::Esxi.as_str(), "esxi");
        assert_eq!(TargetType::Esxi.default_port(), 443);
        assert_eq!(TargetType::Esxi.default_username(), "root");
        assert_eq!(ConnectionProtocol::parse("https").unwrap(), ConnectionProtocol::Https);
        assert_eq!(ConnectionProtocol::Https.default_port(), 443);
        assert_eq!(allowed_protocols(TargetType::Esxi), &[ConnectionProtocol::Https][..]);
        assert_eq!(primary_protocol(TargetType::Esxi), ConnectionProtocol::Https);
        assert!(is_auth_allowed(ConnectionProtocol::Https, "credentialConfig"));
        assert!(!is_auth_allowed(ConnectionProtocol::Https, "privateKey"));

        assert!(validate_target_protocol("esxi", "https").is_ok());
        assert!(validate_target_protocol("linux", "https").is_err());
        assert!(validate_target_protocol("esxi", "ssh").is_err());
        assert_eq!(
            normalize_protocols(None, TargetType::Esxi, ConnectionProtocol::Https),
            r#"["https"]"#
        );
        assert_eq!(
            migration_protocol_override("esxi", "redfish"),
            Some("https")
        );

        let caps = capabilities(TargetType::Esxi);
        assert!(!caps.ssh_backed && !caps.terminal && !caps.metrics);
        assert!(!caps.files && !caps.probe);
        assert!(caps.tls_cert_override && caps.requires_host);
        let snapshot = capability_snapshot("esxi");
        assert_eq!(snapshot["targetType"], "esxi");
        assert_eq!(snapshot["tlsCertOverride"], true);
        assert_eq!(snapshot["sshBacked"], false);
    }

    /// Phase 2-C：Kubernetes / k8s 的注册契约。
    #[test]
    fn k8s_registration_is_table_driven() {
        assert_eq!(TargetType::parse("kubernetes").unwrap(), TargetType::Kubernetes);
        assert_eq!(TargetType::Kubernetes.as_str(), "kubernetes");
        assert_eq!(TargetType::Kubernetes.default_port(), 6443);
        assert_eq!(TargetType::Kubernetes.default_username(), "");
        assert_eq!(ConnectionProtocol::parse("k8s").unwrap(), ConnectionProtocol::K8s);
        assert_eq!(ConnectionProtocol::K8s.default_port(), 6443);
        assert_eq!(
            allowed_protocols(TargetType::Kubernetes),
            &[ConnectionProtocol::K8s][..]
        );
        assert!(validate_target_protocol("kubernetes", "k8s").is_ok());
        assert!(validate_target_protocol("linux", "k8s").is_err());
        assert!(validate_target_protocol("kubernetes", "https").is_err());
        assert_eq!(
            normalize_protocols(None, TargetType::Kubernetes, ConnectionProtocol::K8s),
            r#"["k8s"]"#
        );
        // "k8s" 只是协议名，不是目标类型名；未知目标仍宽松回退 Linux
        assert!(TargetType::parse("k8s").is_err());
        assert_eq!(TargetType::from_str_lossy("k8s"), TargetType::Linux);
        let caps = capabilities(TargetType::Kubernetes);
        assert!(!caps.ssh_backed && caps.tls_cert_override && caps.requires_host);
        assert_eq!(capability_snapshot("kubernetes")["targetType"], "kubernetes");
    }
}
