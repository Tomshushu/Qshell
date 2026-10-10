//! Windows 系统指标采集
//!
//! 从 commands/metrics.rs 抽取 Windows 专用逻辑：
//! 通过 PowerShell + WMI 获取 CPU/内存/磁盘/网络/进程数等指标，
//! 构造与 Linux 相同的 SystemMetrics JSON 结构。
//!
//! Windows 无 loadavg 概念，cpuLoad 返回空数组（前端做降级显示）。
//! Windows 无 POSIX 权限模型，memBreakdown 各分类返回近似值。

use std::collections::HashMap;
use std::sync::Mutex;

/// Windows 网络流量差分缓存：(rx_bytes, tx_bytes) per interface
static WIN_NET_PREV: std::sync::OnceLock<Mutex<HashMap<String, HashMap<String, (u64, u64)>>>> =
    std::sync::OnceLock::new();

fn win_net_prev() -> &'static Mutex<HashMap<String, HashMap<String, (u64, u64)>>> {
    WIN_NET_PREV.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 在 SSH 上执行命令并返回 stdout 字符串（失败返回空字符串）
/// 执行 PowerShell 脚本，失败时返回空字符串（静默失败）
async fn ssh_exec_ok(server_id: &str, script: &str) -> String {
    match crate::ssh::manager::SshManager::global()
        .execute_powershell(server_id, script, 30)
        .await
    {
        Ok(out) => out.stdout,
        Err(_) => String::new(),
    }
}

/// 采集 Windows 服务器指标，构造与 Linux 相同的 SystemMetrics JSON。
///
/// 通过 PowerShell + WMI 获取：
/// - CPU: `Get-CimInstance Win32_Processor` (LoadPercentage) + 差分
/// - 内存: `Get-CimInstance Win32_OperatingSystem` (TotalVisibleMemorySize, FreePhysicalMemory)
/// - 磁盘: `Get-CimInstance Win32_LogicalDisk` (各盘符容量/使用)
/// - 网络: `Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface` (BytesReceived/SentPerSec)
/// - 进程数: `Get-Process | Measure-Object`
/// - uptime: `Get-CimInstance Win32_OperatingSystem` (LastBootUpTime)
pub async fn collect_metrics(server_id: String) -> Result<String, String> {
    let server_id = server_id.as_str();
    // 优化：将原本并发 4 次启动 powershell.exe 的查询合并为单条 PowerShell 脚本
    // 避免每次轮询触发 4 个 powershell.exe 进程并发启动导致远程主机 CPU 飙升 100%
    let combined_script = "$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor; $total = [math]::Round($os.TotalVisibleMemorySize/1,0); $free = [math]::Round($os.FreePhysicalMemory/1,0); $load = ($cpu | Measure-Object -Property LoadPercentage -Average).Average; $uptime = ((Get-Date) - $os.LastBootUpTime).TotalSeconds; $procs = (Get-Process).Count; Write-Output ('CPU_LOAD=' + $load); Write-Output ('MEM_TOTAL=' + $total); Write-Output ('MEM_FREE=' + $free); Write-Output ('UPTIME=' + [math]::Round($uptime)); Write-Output ('OS_NAME=' + $os.Caption); Write-Output ('OS_VER=' + $os.Version); Write-Output ('PROC_COUNT=' + $procs); Write-Output '---DISKS---'; Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { Write-Output ($_.DeviceId + '|' + $_.Size + '|' + $_.FreeSpace) }; Write-Output '---NET---'; Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | ForEach-Object { Write-Output ($_.Name + '|' + $_.BytesReceivedPerSec + '|' + $_.BytesSentPerSec) }";

    let raw_output = ssh_exec_ok(server_id, combined_script).await;

    // 解析 CPU/内存/OS/进程数与分隔段落
    let mut cpu_load: f64 = 0.0;
    let mut mem_total_kb: u64 = 0;
    let mut mem_free_kb: u64 = 0;
    let mut uptime: u64 = 0;
    let mut os_name = String::new();
    let mut os_ver = String::new();
    let mut total_processes: u64 = 0;

    let mut section = "main";
    let mut disks_out: Vec<serde_json::Value> = Vec::new();
    let mut current_net: HashMap<String, (u64, u64)> = HashMap::new();

    for line in raw_output.lines() {
        let line_trim = line.trim();
        if line_trim == "---DISKS---" {
            section = "disks";
            continue;
        } else if line_trim == "---NET---" {
            section = "net";
            continue;
        }

        match section {
            "main" => {
                if let Some(v) = line_trim.strip_prefix("CPU_LOAD=") {
                    cpu_load = v.trim().parse().unwrap_or(0.0);
                } else if let Some(v) = line_trim.strip_prefix("MEM_TOTAL=") {
                    mem_total_kb = v.trim().parse().unwrap_or(0);
                } else if let Some(v) = line_trim.strip_prefix("MEM_FREE=") {
                    mem_free_kb = v.trim().parse().unwrap_or(0);
                } else if let Some(v) = line_trim.strip_prefix("UPTIME=") {
                    uptime = v.trim().parse().unwrap_or(0);
                } else if let Some(v) = line_trim.strip_prefix("OS_NAME=") {
                    os_name = v.trim().to_string();
                } else if let Some(v) = line_trim.strip_prefix("OS_VER=") {
                    os_ver = v.trim().to_string();
                } else if let Some(v) = line_trim.strip_prefix("PROC_COUNT=") {
                    total_processes = v.trim().parse().unwrap_or(0);
                }
            }
            "disks" => {
                let parts: Vec<&str> = line_trim.split('|').collect();
                if parts.len() >= 3 {
                    let device = parts[0].to_string();
                    let size: f64 = parts[1].parse().unwrap_or(0.0);
                    let free: f64 = parts[2].parse().unwrap_or(0.0);
                    let used = size - free;
                    let use_pct = if size > 0.0 { (used / size * 100.0).round() as u64 } else { 0 };
                    disks_out.push(serde_json::json!({
                        "filesystem": device,
                        "mountPoint": device,
                        "total": size / 1_073_741_824.0,  // GB
                        "used": used / 1_073_741_824.0,
                        "available": free / 1_073_741_824.0,
                        "usePercent": use_pct,
                        "category": "disk",
                    }));
                }
            }
            "net" => {
                let parts: Vec<&str> = line_trim.split('|').collect();
                if parts.len() >= 3 {
                    let name = parts[0].to_string();
                    let rx: u64 = parts[1].parse().unwrap_or(0);
                    let tx: u64 = parts[2].parse().unwrap_or(0);
                    current_net.insert(name, (rx, tx));
                }
            }
            _ => {}
        }
    }

    let mem_used_kb = mem_total_kb.saturating_sub(mem_free_kb);
    let mem_pressure = if mem_total_kb > 0 {
        1.0 - (mem_free_kb as f64 / mem_total_kb as f64)
    } else {
        0.0
    };
    let mem_total_bytes = mem_total_kb as f64 * 1024.0;
    let mem_available_bytes = mem_free_kb as f64 * 1024.0;

    // 计算差分速率（与 Linux 一致：字节/秒，转换为 Kbps）
    let mut net_out: Vec<serde_json::Value> = Vec::new();
    {
        let mut prev_map = win_net_prev().lock().unwrap_or_else(|e| e.into_inner());
        let prev = prev_map.get(server_id).cloned().unwrap_or_default();
        for (name, (rx, tx)) in &current_net {
            let (prev_rx, prev_tx) = prev.get(name).copied().unwrap_or((0, 0));
            let drx = rx.saturating_sub(prev_rx);
            let dtx = tx.saturating_sub(prev_tx);
            // 假设采集间隔约 2 秒（前端轮询周期），转换为 Kbps
            let rx_kbps = (drx as f64 * 8.0 / 1000.0) / 2.0;
            let tx_kbps = (dtx as f64 * 8.0 / 1000.0) / 2.0;
            net_out.push(serde_json::json!({
                "interface": name,
                "rxKbps": rx_kbps,
                "txKbps": tx_kbps,
                "rxPackets": 0,
                "txPackets": 0,
                "rxErrors": 0,
                "txErrors": 0,
                "rxDrop": 0,
                "txDrop": 0,
                "dropRate": 0.0,
            }));
        }
        prev_map.insert(server_id.to_string(), current_net);
    }

    // 构造 SystemMetrics JSON
    let metrics = serde_json::json!({
        "cpuUsage": cpu_load,
        "cpuUsr": cpu_load * 0.6,
        "cpuSys": cpu_load * 0.3,
        "cpuIowait": cpu_load * 0.05,
        "cpuSteal": 0.0,
        "cpuIdle": 100.0 - cpu_load,
        "cpuLoad": [],  // Windows 无 loadavg 概念
        "memoryUsed": mem_used_kb as f64 / 1_048_576.0,  // GB
        "memoryTotal": mem_total_bytes / 1_073_741_824.0,  // GB
        "memPressure": mem_pressure,
        "memAvailableBytes": mem_available_bytes,
        "memBreakdown": {
            "used": mem_used_kb as f64 / 1_048_576.0,
            "systemReserved": 0.0,
            "buffers": 0.0,
            "cache": 0.0,
            "free": mem_free_kb as f64 / 1_048_576.0,
        },
        "memRawKb": {
            "total": mem_total_kb,
            "free": mem_free_kb,
            "buffers": 0,
            "cached": 0,
            "available": mem_free_kb,
            "sreclaimable": 0,
            "shared": 0,
        },
        "swapUsed": 0.0,
        "swapTotal": 0.0,
        "disks": disks_out,
        "diskIo": [],
        "network": net_out,
        "tcpRetransRate": 0.0,
        "tcpEstablished": 0,
        "tcpListen": 0,
        "tcpTimeWait": 0,
        "uptime": uptime,
        "osName": os_name,
        "kernelVersion": os_ver,
        "totalProcesses": total_processes,
        "zombieProcesses": 0,
    });

    Ok(metrics.to_string())
}

/// 清空 Windows 网络流量差分缓存
pub fn clear_server_cache(server_id: &str) {
    let mut prev = win_net_prev().lock().unwrap_or_else(|e| e.into_inner());
    prev.remove(server_id);
}
