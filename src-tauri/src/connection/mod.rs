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
}


impl TargetType {
    /// 从字符串解析（数据库 / 前端传入），未知值回退为 Linux（兼容旧数据）。
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "windows" => TargetType::Windows,
            "network" => TargetType::Network,
            "unix" => TargetType::Unix,
            "bmc" => TargetType::Bmc,
            "serial" => TargetType::Serial,
            "xinchuang" => TargetType::Xinchuang,
            _ => TargetType::Linux,
        }
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
        }
    }

    /// 默认端口（与 [`ConnectionProtocol::default_port`] 协同：优先用协议默认端口）。
    pub fn default_port(&self) -> i32 {
        match self {
            TargetType::Linux
            | TargetType::Network
            | TargetType::Unix
            | TargetType::Xinchuang => 22,
            TargetType::Windows => 3389,
            TargetType::Bmc => 443,
            TargetType::Serial => 115200,
        }
    }

    /// 默认用户名。
    pub fn default_username(&self) -> &'static str {
        match self {
            TargetType::Linux | TargetType::Unix | TargetType::Xinchuang => "root",
            TargetType::Windows => "Administrator",
            TargetType::Network | TargetType::Bmc => "admin",
            TargetType::Serial => "",
        }
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
}


impl ConnectionProtocol {
    pub fn from_str_lossy(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "rdp" => ConnectionProtocol::Rdp,
            "winrm" => ConnectionProtocol::Winrm,
            "telnet" => ConnectionProtocol::Telnet,
            "vnc" => ConnectionProtocol::Vnc,
            "serial" => ConnectionProtocol::Serial,
            "redfish" => ConnectionProtocol::Redfish,
            _ => ConnectionProtocol::Ssh,
        }
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
        }
    }

    /// 当前版本真正具备传输层实现的协议。
    /// WinRM/VNC 仍保留枚举以兼容历史数据，但不能被误当作 SSH 连接。
    pub fn is_implemented(&self) -> bool {
        matches!(self, Self::Ssh | Self::Rdp | Self::Telnet | Self::Serial | Self::Redfish)
    }
}

/// 校验目标类型与协议的组合，避免 UI 选项与后端行为不一致。
/// 返回可直接展示给用户的错误信息。
pub fn validate_target_protocol(target_type: &str, protocol: &str) -> Result<(), String> {
    let target = TargetType::from_str_lossy(target_type);
    let proto = ConnectionProtocol::from_str_lossy(protocol);
    let normalized = protocol.trim().to_ascii_lowercase();

    if !proto.is_implemented() {
        return Err(format!("协议 {} 当前尚未实现，请选择已支持的协议", normalized));
    }

    let allowed = match target {
        TargetType::Linux | TargetType::Unix | TargetType::Xinchuang => {
            matches!(proto, ConnectionProtocol::Ssh)
        }
        TargetType::Windows => matches!(proto, ConnectionProtocol::Ssh | ConnectionProtocol::Rdp),
        TargetType::Network => matches!(proto, ConnectionProtocol::Ssh | ConnectionProtocol::Telnet),
        TargetType::Bmc => matches!(proto, ConnectionProtocol::Redfish),
        TargetType::Serial => matches!(proto, ConnectionProtocol::Serial),
    };

    if allowed {
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
}
