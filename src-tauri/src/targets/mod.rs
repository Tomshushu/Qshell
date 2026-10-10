//! 按连接目标类型组织的平台模块
//!
//! Linux 和 Windows 的实现完全隔离在不同子模块中，
//! 一个模块的修改不会影响另一个模块。

pub mod linux;
pub mod windows;

/// 快照采集命令集合（公共数据类型）
///
/// 各目标模块（linux/windows）的 `build_snapshot_commands()` 均返回此类型，
/// 实现逻辑各自隔离，但数据结构统一，便于 commands 路由层按 target_type 分发。
pub struct SnapshotCommands {
    pub metrics_cmd: String,
    pub services_cmd: String,
    pub processes_cmd: String,
    pub ports_cmd: String,
    pub docker_cmd: String,
    /// 详细系统信息采集命令（发行版/版本号/内核/架构/主机名/CPU 等），
    /// 输出 key=value 格式，每行一个字段，便于前端结构化解析展示。
    pub system_info_cmd: String,
}
