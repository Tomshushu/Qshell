//! Windows 目标专用实现
//!
//! 包含 Windows 平台的所有命令构造和执行逻辑，
//! 与 Linux 模块完全隔离。所有命令通过 `cmd /c` 中转调用 PowerShell，
//! 兼容 Git Bash / PowerShell / cmd 等不同默认 shell 环境。

pub mod files;
pub mod services;
pub mod processes;
pub mod ports;
pub mod network;
pub mod logs;
pub mod metrics;
pub mod snapshot;
pub mod os_detect;
pub mod home_dir;
pub mod validators;
pub mod path_resolver;
pub mod transfer_manager;
pub mod transfer;
