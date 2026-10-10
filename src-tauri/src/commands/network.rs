// 网络诊断 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   network:dns / network:ping / network:tcpCheck / network:httpCheck
// 以及全新重构的 Qshell 网络模块能力（net_*）。

use crate::network::*;
use crate::validators::{validate_host_or_ip, validate_port};
use tauri::AppHandle;

use super::CommandResult;

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

// ============================================================================
// 新版网络模块命令 (net_*)
// ============================================================================

/// 网络概览（网卡、IP、默认路由、DNS、监听/连接数、能力）
#[tauri::command]
pub async fn net_overview(server_id: String) -> Result<NetOverview, String> {
    crate::network::exec::get_overview(&server_id).await
}

/// 网卡接口列表与流量统计
#[tauri::command]
pub async fn net_interfaces(server_id: String) -> Result<Vec<InterfaceInfo>, String> {
    crate::network::exec::get_interfaces(&server_id).await
}

/// 路由表
#[tauri::command]
pub async fn net_routes(server_id: String) -> Result<RouteView, String> {
    crate::network::exec::get_routes(&server_id).await
}

/// 针对目标的路由决策 (ip route get)
#[tauri::command]
pub async fn net_route_get(server_id: String, target: String) -> Result<RouteGetResult, String> {
    crate::network::exec::get_route_get(&server_id, &target).await
}

/// DNS 配置与生效解析器
#[tauri::command]
pub async fn net_dns_config(server_id: String) -> Result<DnsConfigInfo, String> {
    crate::network::exec::get_dns_config(&server_id).await
}

/// 监听套接字与活动连接
#[tauri::command]
pub async fn net_connections(
    server_id: String,
    query: Option<ConnQuery>,
) -> Result<ConnPage, String> {
    crate::network::exec::get_connections(&server_id, query).await
}

/// ARP / 邻居表
#[tauri::command]
pub async fn net_neighbors(server_id: String) -> Result<Vec<NeighborInfo>, String> {
    crate::network::exec::get_neighbors(&server_id).await
}

/// 网卡链路与硬件信息 (ethtool)
#[tauri::command]
pub async fn net_ethtool(server_id: String, iface: String) -> Result<EthtoolInfo, String> {
    crate::network::exec::get_ethtool(&server_id, &iface).await
}

/// 主机网络能力探测
#[tauri::command]
pub async fn net_capabilities(server_id: String, refresh: bool) -> Result<HostCapabilities, String> {
    Ok(crate::network::exec::detect_capabilities(&server_id, refresh).await)
}

/// 启动六层流水线一键体检（DNS -> Route -> L3 -> TCP -> TLS -> HTTP）
#[tauri::command]
pub async fn net_run_quick_check(
    app: AppHandle,
    server_id: String,
    target: String,
    port: Option<u16>,
    protocol: Option<String>,
) -> Result<NetworkRun, String> {
    crate::network::exec::run_quick_check(app, server_id, target, port, protocol).await
}

/// 路径追踪 (Traceroute)
#[tauri::command]
pub async fn net_run_traceroute(
    server_id: String,
    target: String,
    mode: Option<String>,
) -> Result<String, String> {
    crate::network::exec::run_traceroute(&server_id, &target, mode.as_deref()).await
}

/// Ping 探测
#[tauri::command]
pub async fn net_run_ping(
    server_id: String,
    target: String,
    count: Option<u32>,
) -> Result<String, String> {
    crate::network::exec::run_ping(&server_id, &target, count).await
}

/// 启动远端抓包 (tcpdump)
#[tauri::command]
pub async fn net_capture_start(
    server_id: String,
    req: CaptureReq,
) -> Result<CaptureResult, String> {
    crate::network::exec::start_capture(&server_id, req).await
}

/// 获取历史体检与诊断记录
#[tauri::command]
pub async fn net_runs_list(
    server_id: String,
    limit: Option<u32>,
) -> Result<Vec<NetworkRunSummary>, String> {
    crate::network::store::list_runs(&server_id, limit.unwrap_or(20))
}

/// 获取单个体检运行记录详情
#[tauri::command]
pub async fn net_run_get(run_id: String) -> Result<Option<NetworkRun>, String> {
    crate::network::store::get_run(&run_id)
}

/// 删除体检运行记录
#[tauri::command]
pub async fn net_run_delete(run_id: String) -> Result<(), String> {
    crate::network::store::delete_run(&run_id)
}

/// 同口径对比两次体检结果 (Diff)
#[tauri::command]
pub async fn net_runs_compare(run_id_a: String, run_id_b: String) -> Result<RunDiff, String> {
    crate::network::store::compare_runs(&run_id_a, &run_id_b)
}

/// 导出体检报告 (JSON, HTML, CSV)
#[tauri::command]
pub async fn net_report_export(run_id: String, format: String) -> Result<ExportResult, String> {
    crate::network::store::export_report(&run_id, &format)
}

// ============================================================================
// 保持向后兼容的旧接口
// ============================================================================

/// DNS 查询
#[tauri::command]
pub async fn network_dns(
    server_id: String,
    target: String,
) -> Result<CommandResult, String> {
    let validation = validate_host_or_ip(target.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid host or IP: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::network::network_dns(server_id, target).await
    } else {
        crate::targets::linux::network::network_dns(server_id, target).await
    }
}

/// Ping 测试（4 次，每次 5 秒超时）
#[tauri::command]
pub async fn network_ping(
    server_id: String,
    target: String,
) -> Result<CommandResult, String> {
    let validation = validate_host_or_ip(target.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid host or IP: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::network::network_ping(server_id, target).await
    } else {
        crate::targets::linux::network::network_ping(server_id, target).await
    }
}

/// TCP 端口连通性检查
#[tauri::command]
pub async fn network_tcp_check(
    server_id: String,
    host: String,
    port: i64,
) -> Result<CommandResult, String> {
    let host_validation = validate_host_or_ip(host.clone());
    if !host_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid host or IP: {}",
            host_validation.error.unwrap_or_default()
        )));
    }
    let port_validation = validate_port(port.to_string());
    if !port_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid port: {}",
            port_validation.error.unwrap_or_default()
        )));
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::network::network_tcp_check(server_id, host, port).await
    } else {
        crate::targets::linux::network::network_tcp_check(server_id, host, port).await
    }
}

/// HTTP 可达性检查
#[tauri::command]
pub async fn network_http_check(
    server_id: String,
    url: String,
) -> Result<CommandResult, String> {
    if url.is_empty() {
        return Ok(CommandResult::err(
            "Invalid URL: URL is required and must be a string",
        ));
    }
    let dangerous_chars = [
        ';', '|', '&', '$', '`', '\n', '\0', '(', ')', '{', '}',
    ];
    for &ch in &dangerous_chars {
        if url.contains(ch) {
            return Ok(CommandResult::err(
                "Invalid URL: contains prohibited characters",
            ));
        }
    }
    if url.contains("$(") {
        return Ok(CommandResult::err(
            "Invalid URL: contains command substitution pattern",
        ));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(CommandResult::err(
            "Invalid URL: only http and https protocols are allowed",
        ));
    }
    crate::targets::linux::network::network_http_check(server_id, url).await
}
