use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;
use regex::Regex;

// Pre-compiled regex patterns for metrics parsing
static CPU_STAT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)").unwrap());
static PRETTY_NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^PRETTY_NAME=(.+)$").unwrap());
static NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^NAME=(.+)$").unwrap());
static LOAD_AVG_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([\d.]+)\s+([\d.]+)\s+([\d.]+)").unwrap());
static LOAD_UPTIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)").unwrap());
static UPTIME_DAYS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"up\s+(\d+)\s+days?,\s+(\d+):(\d+)").unwrap());
static UPTIME_HOURS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"up\s+(\d+):(\d+)").unwrap());
static UPTIME_MIN_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"up\s+(\d+)\s+min").unwrap());

// ============================================================
// Data structures matching TypeScript types
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuStat {
    pub user: u64,
    pub nice: u64,
    pub system: u64,
    pub idle: u64,
    pub iowait: u64,
    pub irq: u64,
    pub softirq: u64,
    pub steal: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemInfo {
    pub total_kb: u64,
    pub free_kb: u64,
    pub available_kb: u64,
    pub buffers_kb: u64,
    pub cached_kb: u64,
    pub sreclaimable_kb: u64,
    pub anon_pages_kb: u64,
    pub shared_kb: u64,
    pub swap_total_kb: u64,
    pub swap_free_kb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskStat {
    pub read_completed: u64,
    pub read_sectors: u64,
    pub write_completed: u64,
    pub write_sectors: u64,
    pub io_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetDev {
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_packets: u64,
    pub tx_packets: u64,
    pub rx_errors: u64,
    pub tx_errors: u64,
    pub rx_drop: u64,
    pub tx_drop: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TcpSnmp {
    pub out_segs: u64,
    pub retrans_segs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TcpStateCounts {
    pub established: u64,
    pub listen: u64,
    pub time_wait: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount_point: String,
    pub total: f64,
    pub used: f64,
    pub available: f64,
    pub use_percent: u64,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub kernel_version: String,
    pub os_name: String,
    pub uptime: u64,
    pub cpu_load: [f64; 3],
    pub disks: Vec<DiskInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStates {
    pub total_processes: u64,
    pub zombie_processes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemBreakdown {
    pub system_reserved: f64,
    pub buffers: f64,
    pub cache: f64,
    pub free: f64,
    pub used: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemRawKb {
    pub total: u64,
    pub free: u64,
    pub buffers: u64,
    pub cached: u64,
    pub available: u64,
    pub sreclaimable: u64,
    pub shared: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskIoInfo {
    pub device: String,
    pub read_iops: f64,
    pub write_iops: f64,
    pub read_mbps: f64,
    pub write_mbps: f64,
    pub util: f64,
    pub r#await: f64,
    pub iowait: f64,
    pub read_kbps: f64,
    pub write_kbps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub interface: String,
    pub rx_kbps: f64,
    pub tx_kbps: f64,
    pub drop_rate: f64,
    pub rx_packets: u64,
    pub tx_packets: u64,
    pub rx_errors: u64,
    pub tx_errors: u64,
    pub rx_drop: u64,
    pub tx_drop: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_usage: f64,
    pub cpu_usr: f64,
    pub cpu_sys: f64,
    pub cpu_iowait: f64,
    pub cpu_steal: f64,
    pub cpu_idle: f64,
    pub cpu_load: Vec<f64>,
    pub memory_used: f64,
    pub memory_total: f64,
    pub mem_pressure: f64,
    pub mem_available_bytes: f64,
    pub mem_breakdown: MemBreakdown,
    pub mem_raw_kb: MemRawKb,
    pub swap_used: f64,
    pub swap_total: f64,
    pub disks: Vec<DiskInfo>,
    pub disk_io: Vec<DiskIoInfo>,
    pub network: Vec<NetworkInfo>,
    pub tcp_retrans_rate: f64,
    pub tcp_established: u64,
    pub tcp_listen: u64,
    pub tcp_time_wait: u64,
    pub uptime: u64,
    pub os_name: String,
    pub kernel_version: String,
    pub total_processes: u64,
    pub zombie_processes: u64,
}

/// Raw snapshot from SSH command outputs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSnapshot {
    pub core: String,
    pub disk_io: String,
    pub net: String,
    pub proc: String,
    pub mounts: String,
    pub tcp_snmp: TcpSnmp,
    pub tcp_states: TcpStateCounts,
}

// ============================================================
// Helper: round to N decimal places (matches JS Math.round(x * M) / M)
// ============================================================

fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn round4(v: f64) -> f64 {
    (v * 10000.0).round() / 10000.0
}

// ============================================================
// Parsers
// ============================================================

/// Parse /proc/stat first line → CpuStat
pub fn parse_cpu_stat(core_raw: &str) -> Option<CpuStat> {
    let caps = CPU_STAT_RE.captures(core_raw)?;
    Some(CpuStat {
        user: caps[1].parse().ok()?,
        nice: caps[2].parse().ok()?,
        system: caps[3].parse().ok()?,
        idle: caps[4].parse().ok()?,
        iowait: caps[5].parse().ok()?,
        irq: caps[6].parse().ok()?,
        softirq: caps[7].parse().ok()?,
        steal: caps[8].parse().ok()?,
    })
}

/// Parse /proc/meminfo → MemInfo
pub fn parse_meminfo(core_raw: &str) -> MemInfo {
    let mut mem_map: HashMap<String, u64> = HashMap::new();
    for line in core_raw.split('\n') {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let key = parts[0].trim_end_matches(':').to_string();
            mem_map.insert(key, parts[1].parse().unwrap_or(0));
        }
        // Stop at df header line
        if line.starts_with("Filesystem") {
            break;
        }
    }

    let total = *mem_map.get("MemTotal").unwrap_or(&0);
    let free = *mem_map.get("MemFree").unwrap_or(&0);
    let buffers = *mem_map.get("Buffers").unwrap_or(&0);
    let cached = *mem_map.get("Cached").unwrap_or(&0);
    let s_reclaimable = *mem_map.get("SReclaimable").unwrap_or(&0);
    let available = *mem_map.get("MemAvailable").unwrap_or(&(free + buffers + cached + s_reclaimable));
    let anon_pages = *mem_map.get("AnonPages").unwrap_or(&0);
    let shmem = *mem_map.get("Shmem").unwrap_or(&0);

    MemInfo {
        total_kb: total,
        free_kb: free,
        available_kb: available,
        buffers_kb: buffers,
        cached_kb: cached,
        sreclaimable_kb: s_reclaimable,
        anon_pages_kb: anon_pages,
        shared_kb: shmem,
        swap_total_kb: *mem_map.get("SwapTotal").unwrap_or(&0),
        swap_free_kb: *mem_map.get("SwapFree").unwrap_or(&0),
    }
}

/// Parse /proc/diskstats → HashMap<device_name, DiskStat>
pub fn parse_diskstats(disk_io_raw: &str) -> HashMap<String, DiskStat> {
    let mut map = HashMap::new();
    for line in disk_io_raw.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 14 {
            let name = parts[2].to_string();
            map.insert(
                name,
                DiskStat {
                    read_completed: parts[3].parse().unwrap_or(0),
                    read_sectors: parts[5].parse().unwrap_or(0),
                    write_completed: parts[7].parse().unwrap_or(0),
                    write_sectors: parts[9].parse().unwrap_or(0),
                    io_ms: parts[12].parse().unwrap_or(0),
                },
            );
        }
    }
    map
}

/// Parse /proc/net/dev → HashMap<interface, NetDev>
pub fn parse_net_dev(net_raw: &str) -> HashMap<String, NetDev> {
    let mut map = HashMap::new();
    for line in net_raw.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let colon_idx = match trimmed.find(':') {
            Some(i) => i,
            None => continue,
        };
        let iface = trimmed[..colon_idx].trim().to_string();
        let nums: Vec<&str> = trimmed[colon_idx + 1..].split_whitespace().collect();
        if nums.len() >= 12 {
            map.insert(
                iface,
                NetDev {
                    rx_bytes: nums[0].parse().unwrap_or(0),
                    tx_bytes: nums[8].parse().unwrap_or(0),
                    rx_packets: nums[1].parse().unwrap_or(0),
                    tx_packets: nums[9].parse().unwrap_or(0),
                    rx_errors: nums[2].parse().unwrap_or(0),
                    tx_errors: nums[10].parse().unwrap_or(0),
                    rx_drop: nums[3].parse().unwrap_or(0),
                    tx_drop: nums[11].parse().unwrap_or(0),
                },
            );
        }
    }
    map
}

/// Parse /proc/net/snmp Tcp lines → TcpSnmp
pub fn parse_tcp_snmp(core_raw: &str) -> TcpSnmp {
    let lines: Vec<&str> = core_raw.split('\n').collect();
    let mut header_idx: Option<usize> = None;

    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("Tcp:") && line.contains("RtoAlgorithm") {
            header_idx = Some(i);
            break;
        }
    }

    let header_idx = match header_idx {
        Some(idx) if idx + 1 < lines.len() => idx,
        _ => return TcpSnmp { out_segs: 0, retrans_segs: 0 },
    };

    let header_line = lines[header_idx];
    let value_line = lines[header_idx + 1];

    if !value_line.starts_with("Tcp:") {
        return TcpSnmp { out_segs: 0, retrans_segs: 0 };
    }

    let headers: Vec<&str> = header_line.split_whitespace().collect();
    let values: Vec<&str> = value_line.split_whitespace().collect();

    let out_idx = headers.iter().position(|&h| h == "OutSegs");
    let retrans_idx = headers.iter().position(|&h| h == "RetransSegs");

    let (Some(out_idx), Some(retrans_idx)) = (out_idx, retrans_idx) else {
        return TcpSnmp { out_segs: 0, retrans_segs: 0 };
    };

    TcpSnmp {
        out_segs: values.get(out_idx).and_then(|v| v.parse().ok()).unwrap_or(0),
        retrans_segs: values.get(retrans_idx).and_then(|v| v.parse().ok()).unwrap_or(0),
    }
}

/// Parse TCP state hex codes from /proc/net/tcp and tcp6.
pub fn parse_tcp_states(core_raw: &str) -> TcpStateCounts {
    let mut counts = TcpStateCounts::default();
    let Some(section) = core_raw.split("::TCP_STATES::").nth(1) else {
        return counts;
    };
    for state in section.lines().map(str::trim) {
        match state {
            "01" => counts.established += 1,
            "0A" => counts.listen += 1,
            "06" => counts.time_wait += 1,
            _ => {}
        }
    }
    counts
}

/// Parse system info (kernel version, OS name, uptime, load, disk usage)
pub fn parse_system_info(core_raw: &str, mounts_raw: &str) -> SystemInfo {
    let mut result = SystemInfo {
        kernel_version: String::new(),
        os_name: String::new(),
        uptime: 0,
        cpu_load: [0.0, 0.0, 0.0],
        disks: Vec::new(),
    };

    let lines: Vec<&str> = core_raw.split('\n').collect();

    // Kernel version from uname -a
    for line in &lines {
        if line.contains("GNU") || line.contains("Linux") {
            let parts: Vec<&str> = line.split(' ').collect();
            if parts.len() > 2 {
                result.kernel_version = parts[2].to_string();
            }
            break;
        }
    }

    // OS name (PRETTY_NAME > NAME, strip quotes)
    let os_raw = PRETTY_NAME_RE.captures(core_raw)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .or_else(|| {
            NAME_RE.captures(core_raw)
                .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        })
        .unwrap_or_default();

    result.os_name = os_raw
        .trim_start_matches('"')
        .trim_start_matches('\'')
        .trim_end_matches('"')
        .trim_end_matches('\'')
        .trim()
        .to_string();

    // Load average from /proc/loadavg
    if let Some(caps) = LOAD_AVG_RE.captures(core_raw) {
        result.cpu_load = [
            caps[1].parse().unwrap_or(0.0),
            caps[2].parse().unwrap_or(0.0),
            caps[3].parse().unwrap_or(0.0),
        ];
    }
    // Fallback: uptime load average format
    if result.cpu_load == [0.0, 0.0, 0.0] {
        if let Some(caps) = LOAD_UPTIME_RE.captures(core_raw) {
            result.cpu_load = [
                caps[1].parse().unwrap_or(0.0),
                caps[2].parse().unwrap_or(0.0),
                caps[3].parse().unwrap_or(0.0),
            ];
        }
    }

    // Uptime parsing
    if let Some(caps) = UPTIME_DAYS_RE.captures(core_raw) {
        let days: u64 = caps[1].parse().unwrap_or(0);
        let hours: u64 = caps[2].parse().unwrap_or(0);
        let mins: u64 = caps[3].parse().unwrap_or(0);
        result.uptime = days * 86400 + hours * 3600 + mins * 60;
    }
    if result.uptime == 0 {
        if let Some(caps) = UPTIME_HOURS_RE.captures(core_raw) {
            let hours: u64 = caps[1].parse().unwrap_or(0);
            let mins: u64 = caps[2].parse().unwrap_or(0);
            result.uptime = hours * 3600 + mins * 60;
        }
    }
    if result.uptime == 0 {
        if let Some(caps) = UPTIME_MIN_RE.captures(core_raw) {
            let mins: u64 = caps[1].parse().unwrap_or(0);
            result.uptime = mins * 60;
        }
    }

    // Disk usage from df -Pk + /proc/mounts fstype categorization
    // 1. Parse /proc/mounts → mountPoint → fstype
    let mut mounts_map: HashMap<String, String> = HashMap::new();
    for ml in mounts_raw.split('\n') {
        let mp: Vec<&str> = ml.split_whitespace().collect();
        if mp.len() >= 3 && mp[1].starts_with('/') {
            mounts_map.insert(mp[1].to_string(), mp[2].to_string());
        }
    }

    // 2. fstype → category
    let virtual_fs: std::collections::HashSet<&str> = [
        "proc", "procfs", "sysfs", "securityfs", "debugfs", "fusectl",
        "cgroup", "cgroup2", "devpts", "devtmpfs", "pstore", "tracefs",
        "configfs", "binfmt_misc", "mqueue", "rpc_pipefs", "hugetlbfs",
        "autofs", "squashfs", "iso9660",
    ].iter().cloned().collect();

    let hide_fs: std::collections::HashSet<&str> = ["overlay", "aufs", "nsfs", "fuse.lxcfs"]
        .iter()
        .cloned()
        .collect();

    let hide_mount_prefix = ["/var/lib/docker/", "/var/lib/kubelet/", "/snap/"];

    fn tag_category(
        device: &str,
        fstype: &str,
        mount_point: &str,
        virtual_fs: &std::collections::HashSet<&str>,
        hide_fs: &std::collections::HashSet<&str>,
        hide_mount_prefix: &[&str],
    ) -> &'static str {
        // hide: container/snapshot mounts
        if hide_fs.contains(fstype) {
            return "hide";
        }
        if hide_mount_prefix.iter().any(|p| mount_point.starts_with(p)) {
            return "hide";
        }
        // virtual: virtual filesystems
        if virtual_fs.contains(fstype) {
            return "virtual";
        }
        if mount_point.starts_with("/proc/") || mount_point.starts_with("/sys/") {
            return "virtual";
        }
        // tmpfs: memory filesystems
        if fstype == "tmpfs" {
            return "tmpfs";
        }
        // disk: real physical partitions
        if device.starts_with("/dev/") {
            return "disk";
        }
        // fallback: has fstype but not in above categories → disk
        if !fstype.is_empty() {
            return "disk";
        }
        "virtual"
    }

    // 3. Parse df -Pk
    let df_started = lines.iter().position(|l| l.starts_with("Filesystem"));
    if let Some(df_start) = df_started {
        for line in lines.iter().skip(df_start + 1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() != 6 {
                continue;
            }
            let device = parts[0];
            let total_kb: u64 = match parts[1].parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let used_kb: u64 = match parts[2].parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let avail_kb: u64 = match parts[3].parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let use_pct_str = parts[4];
            let mount_point = parts[5];

            if !mount_point.starts_with('/') {
                continue;
            }
            if !use_pct_str.ends_with('%') {
                continue;
            }

            let fstype = mounts_map.get(mount_point).map(|s| s.as_str()).unwrap_or("");
            let category = tag_category(device, fstype, mount_point, &virtual_fs, &hide_fs, &hide_mount_prefix);

            // Only return disk and tmpfs
            if category == "virtual" || category == "hide" {
                continue;
            }

            let use_percent_str = use_pct_str.trim_end_matches('%');
            let use_percent: u64 = use_percent_str.parse().unwrap_or(0);

            result.disks.push(DiskInfo {
                filesystem: device.to_string(),
                mount_point: mount_point.to_string(),
                total: total_kb as f64 / (1024.0 * 1024.0),
                used: used_kb as f64 / (1024.0 * 1024.0),
                available: avail_kb as f64 / (1024.0 * 1024.0),
                use_percent,
                category: category.to_string(),
            });
        }
    }

    result
}

/// Parse ps state counts → ProcessStates
pub fn parse_process_states(proc_raw: &str) -> ProcessStates {
    let mut total: u64 = 0;
    let mut zombies: u64 = 0;

    for line in proc_raw.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            let count: u64 = parts[0].parse().unwrap_or(0);
            total += count;
            if parts[1] == "Z" {
                zombies = count;
            }
        }
    }

    ProcessStates {
        total_processes: total,
        zombie_processes: zombies,
    }
}

/// Create default metrics structure
pub fn create_default_metrics() -> SystemMetrics {
    SystemMetrics {
        cpu_usage: 0.0,
        cpu_usr: 0.0,
        cpu_sys: 0.0,
        cpu_iowait: 0.0,
        cpu_steal: 0.0,
        cpu_idle: 0.0,
        cpu_load: vec![0.0, 0.0, 0.0],
        memory_used: 0.0,
        memory_total: 0.0,
        mem_pressure: 0.0,
        mem_available_bytes: 0.0,
        mem_breakdown: MemBreakdown {
            system_reserved: 0.0,
            buffers: 0.0,
            cache: 0.0,
            free: 0.0,
            used: 0.0,
        },
        mem_raw_kb: MemRawKb {
            total: 0,
            free: 0,
            buffers: 0,
            cached: 0,
            available: 0,
            sreclaimable: 0,
            shared: 0,
        },
        swap_used: 0.0,
        swap_total: 0.0,
        disks: Vec::new(),
        disk_io: Vec::new(),
        network: Vec::new(),
        tcp_retrans_rate: 0.0,
        tcp_established: 0,
        tcp_listen: 0,
        tcp_time_wait: 0,
        uptime: 0,
        os_name: String::new(),
        kernel_version: String::new(),
        total_processes: 0,
        zombie_processes: 0,
    }
}

/// Fill memory metrics into result from a MemInfo snapshot
fn fill_memory_metrics(result: &mut SystemMetrics, mem_snap: &MemInfo) {
    let total_bytes = mem_snap.total_kb as f64 * 1024.0;
    let available_bytes = mem_snap.available_kb as f64 * 1024.0;
    result.memory_total = round2(total_bytes / (1024.0 * 1024.0 * 1024.0));
    result.memory_used = round2((total_bytes - available_bytes) / (1024.0 * 1024.0 * 1024.0));
    result.mem_pressure = if total_bytes > 0.0 {
        round3(1.0 - available_bytes / total_bytes)
    } else {
        0.0
    };
    result.mem_available_bytes = available_bytes;

    // Memory breakdown: 5 mutually exclusive categories
    let kb_to_gb = 1024.0 * 1024.0;
    let app_used_kb = mem_snap.anon_pages_kb as f64;
    let system_reserved_kb = 0f64.max(
        mem_snap.total_kb as f64 - mem_snap.free_kb as f64 - mem_snap.buffers_kb as f64
            - mem_snap.cached_kb as f64
            - app_used_kb,
    );
    result.mem_breakdown = MemBreakdown {
        system_reserved: round2(system_reserved_kb / kb_to_gb),
        buffers: round2(mem_snap.buffers_kb as f64 / kb_to_gb),
        cache: round2(mem_snap.cached_kb as f64 / kb_to_gb),
        free: round2(mem_snap.free_kb as f64 / kb_to_gb),
        used: round2(app_used_kb / kb_to_gb),
    };
    result.mem_raw_kb = MemRawKb {
        total: mem_snap.total_kb,
        free: mem_snap.free_kb,
        buffers: mem_snap.buffers_kb,
        cached: mem_snap.cached_kb,
        available: mem_snap.available_kb,
        sreclaimable: mem_snap.sreclaimable_kb,
        shared: mem_snap.shared_kb,
    };
    result.swap_total = round2(mem_snap.swap_total_kb as f64 * 1024.0 / (1024.0 * 1024.0 * 1024.0));
    result.swap_used = round2(
        (mem_snap.swap_total_kb - mem_snap.swap_free_kb) as f64 * 1024.0 / (1024.0 * 1024.0 * 1024.0),
    );
}

/// First snapshot (no diff) - static info only, rate metrics are 0
pub fn parse_snapshot_only(cur_raw: &RawSnapshot) -> SystemMetrics {
    let mut result = create_default_metrics();
    let sys_info = parse_system_info(&cur_raw.core, &cur_raw.mounts);
    let proc_info = parse_process_states(&cur_raw.proc);

    // Memory
    let mem_snap = parse_meminfo(&cur_raw.core);
    fill_memory_metrics(&mut result, &mem_snap);

    // Network interfaces - first snapshot returns list with rate=0
    let cur_net = parse_net_dev(&cur_raw.net);
    for (iface, snap) in &cur_net {
        result.network.push(NetworkInfo {
            interface: iface.clone(),
            rx_kbps: 0.0,
            tx_kbps: 0.0,
            drop_rate: 0.0,
            rx_packets: snap.rx_packets,
            tx_packets: snap.tx_packets,
            rx_errors: snap.rx_errors,
            tx_errors: snap.tx_errors,
            rx_drop: snap.rx_drop,
            tx_drop: snap.tx_drop,
        });
    }

    // Disk I/O - first snapshot returns device list with rate=0
    let cur_disk = parse_diskstats(&cur_raw.disk_io);
    for name in cur_disk.keys() {
        result.disk_io.push(DiskIoInfo {
            device: name.clone(),
            read_iops: 0.0,
            write_iops: 0.0,
            read_mbps: 0.0,
            write_mbps: 0.0,
            util: 0.0,
            r#await: 0.0,
            iowait: 0.0,
            read_kbps: 0.0,
            write_kbps: 0.0,
        });
    }

    result.kernel_version = sys_info.kernel_version;
    result.os_name = sys_info.os_name;
    result.uptime = sys_info.uptime;
    result.cpu_load = sys_info.cpu_load.to_vec();
    result.disks = sys_info.disks;
    result.total_processes = proc_info.total_processes;
    result.zombie_processes = proc_info.zombie_processes;
    let tcp_states = &cur_raw.tcp_states;
    result.tcp_established = tcp_states.established;
    result.tcp_listen = tcp_states.listen;
    result.tcp_time_wait = tcp_states.time_wait;

    result
}

/// Diff calculation: compare two snapshots, compute rates and ratios
pub fn parse_metrics_diff(prev: &RawSnapshot, cur: &RawSnapshot, dt_secs: f64) -> SystemMetrics {
    let mut result = create_default_metrics();

    // ---- CPU diff metrics ----
    let prev_cpu = parse_cpu_stat(&prev.core);
    let cur_cpu = parse_cpu_stat(&cur.core);

    if let (Some(prev_c), Some(cur_c)) = (prev_cpu, cur_cpu) {
        let d_user = cur_c.user as f64 - prev_c.user as f64;
        let d_nice = cur_c.nice as f64 - prev_c.nice as f64;
        let d_system = cur_c.system as f64 - prev_c.system as f64;
        let d_idle = cur_c.idle as f64 - prev_c.idle as f64;
        let d_iowait = cur_c.iowait as f64 - prev_c.iowait as f64;
        let d_irq = cur_c.irq as f64 - prev_c.irq as f64;
        let d_softirq = cur_c.softirq as f64 - prev_c.softirq as f64;
        let d_steal = cur_c.steal as f64 - prev_c.steal as f64;

        let d_total = d_user + d_nice + d_system + d_idle + d_iowait + d_irq + d_softirq + d_steal;
        if d_total > 0.0 {
            result.cpu_usr = round1((d_user + d_nice) / d_total * 1000.0) / 10.0;
            result.cpu_sys = round1((d_system + d_irq + d_softirq) / d_total * 1000.0) / 10.0;
            result.cpu_iowait = round1(d_iowait / d_total * 1000.0) / 10.0;
            result.cpu_steal = round1(d_steal / d_total * 1000.0) / 10.0;
            result.cpu_idle = round1(d_idle / d_total * 1000.0) / 10.0;
            result.cpu_usage = round1((result.cpu_usr + result.cpu_sys + result.cpu_iowait + result.cpu_steal) * 10.0) / 10.0;
        }
    }

    // ---- Memory metrics (current snapshot, no diff needed) ----
    let mem_snap = parse_meminfo(&cur.core);
    fill_memory_metrics(&mut result, &mem_snap);

    // ---- Disk I/O diff metrics ----
    let prev_disk = parse_diskstats(&prev.disk_io);
    let cur_disk = parse_diskstats(&cur.disk_io);
    const SECTOR_SIZE: f64 = 512.0;

    for (name, cur_snap) in &cur_disk {
        let prev_snap = match prev_disk.get(name) {
            Some(s) => s,
            None => continue,
        };

        let drc = cur_snap.read_completed as f64 - prev_snap.read_completed as f64;
        let dwc = cur_snap.write_completed as f64 - prev_snap.write_completed as f64;
        let drs = cur_snap.read_sectors as f64 - prev_snap.read_sectors as f64;
        let dws = cur_snap.write_sectors as f64 - prev_snap.write_sectors as f64;
        let dio_ms = cur_snap.io_ms as f64 - prev_snap.io_ms as f64;

        let r_mbps = (drs * SECTOR_SIZE) / dt_secs / (1024.0 * 1024.0);
        let w_mbps = (dws * SECTOR_SIZE) / dt_secs / (1024.0 * 1024.0);
        let r_iops = drc / dt_secs;
        let w_iops = dwc / dt_secs;
        let util = (dio_ms / 1000.0 / dt_secs).min(1.0);
        let total_ios = drc + dwc;
        let await_ms = if total_ios > 0.0 { dio_ms / total_ios } else { 0.0 };

        result.disk_io.push(DiskIoInfo {
            device: name.clone(),
            read_iops: round1(r_iops),
            write_iops: round1(w_iops),
            read_mbps: round2(r_mbps),
            write_mbps: round2(w_mbps),
            util: round3(util),
            r#await: round1(await_ms),
            iowait: result.cpu_iowait,
            read_kbps: (r_mbps * 1024.0 * 8.0).round(),
            write_kbps: (w_mbps * 1024.0 * 8.0).round(),
        });
    }

    // ---- Network diff metrics ----
    let prev_net = parse_net_dev(&prev.net);
    let cur_net = parse_net_dev(&cur.net);

    for (iface, cur_snap) in &cur_net {
        let (rx_kbps, tx_kbps, drop_rate) = match prev_net.get(iface) {
            Some(prev_snap) => {
                let d_rx_bytes = cur_snap.rx_bytes as f64 - prev_snap.rx_bytes as f64;
                let d_tx_bytes = cur_snap.tx_bytes as f64 - prev_snap.tx_bytes as f64;
                let rx = (d_rx_bytes * 8.0 / dt_secs / 1024.0).round();
                let tx = (d_tx_bytes * 8.0 / dt_secs / 1024.0).round();

                let d_drop = (cur_snap.rx_drop as f64 - prev_snap.rx_drop as f64)
                    + (cur_snap.tx_drop as f64 - prev_snap.tx_drop as f64);
                let d_packets = (cur_snap.rx_packets as f64 - prev_snap.rx_packets as f64)
                    + (cur_snap.tx_packets as f64 - prev_snap.tx_packets as f64);
                let dr = if d_packets > 0.0 {
                    round3(d_drop / d_packets)
                } else {
                    0.0
                };
                (rx, tx, dr)
            }
            None => (0.0, 0.0, 0.0),
        };

        result.network.push(NetworkInfo {
            interface: iface.clone(),
            rx_kbps,
            tx_kbps,
            drop_rate,
            rx_packets: cur_snap.rx_packets,
            tx_packets: cur_snap.tx_packets,
            rx_errors: cur_snap.rx_errors,
            tx_errors: cur_snap.tx_errors,
            rx_drop: cur_snap.rx_drop,
            tx_drop: cur_snap.tx_drop,
        });
    }

    // ---- TCP retransmit rate ----
    let prev_tcp = &prev.tcp_snmp;
    let cur_tcp = &cur.tcp_snmp;
    let d_out_segs = cur_tcp.out_segs as f64 - prev_tcp.out_segs as f64;
    let d_retrans = cur_tcp.retrans_segs as f64 - prev_tcp.retrans_segs as f64;
    // Minimum sample: 500 OutSegs
    const MIN_OUTSEGS: f64 = 500.0;
    result.tcp_retrans_rate = if d_out_segs >= MIN_OUTSEGS {
        round4(d_retrans / d_out_segs)
    } else {
        0.0
    };
    let tcp_states = &cur.tcp_states;
    result.tcp_established = tcp_states.established;
    result.tcp_listen = tcp_states.listen;
    result.tcp_time_wait = tcp_states.time_wait;

    // ---- System info ----
    let sys_info = parse_system_info(&cur.core, &cur.mounts);
    result.kernel_version = sys_info.kernel_version;
    result.os_name = sys_info.os_name;
    result.uptime = sys_info.uptime;
    result.cpu_load = sys_info.cpu_load.to_vec();
    result.disks = sys_info.disks;

    // ---- Process states ----
    let proc_info = parse_process_states(&cur.proc);
    result.total_processes = proc_info.total_processes;
    result.zombie_processes = proc_info.zombie_processes;

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cpu_stat_valid() {
        let raw = "cpu  2255 34 2290 22625563 6290 127 456 0\ncpu0 1100 20 ...";
        let stat = parse_cpu_stat(raw).unwrap();
        assert_eq!(stat.user, 2255);
        assert_eq!(stat.nice, 34);
        assert_eq!(stat.system, 2290);
        assert_eq!(stat.idle, 22625563);
        assert_eq!(stat.iowait, 6290);
        assert_eq!(stat.irq, 127);
        assert_eq!(stat.softirq, 456);
        assert_eq!(stat.steal, 0);
    }

    #[test]
    fn test_parse_cpu_stat_invalid() {
        assert!(parse_cpu_stat("").is_none());
        assert!(parse_cpu_stat("no cpu line here").is_none());
    }

    #[test]
    fn test_parse_meminfo_valid() {
        let raw = "MemTotal:       16384000 kB\n\
                   MemFree:         4096000 kB\n\
                   MemAvailable:    8192000 kB\n\
                   Buffers:          512000 kB\n\
                   Cached:          3072000 kB\n\
                   SwapTotal:       2048000 kB\n\
                   SwapFree:        1024000 kB\n\
                   Filesystem      1K-blocks";
        let info = parse_meminfo(raw);
        assert_eq!(info.total_kb, 16384000);
        assert_eq!(info.free_kb, 4096000);
        assert_eq!(info.available_kb, 8192000);
        assert_eq!(info.buffers_kb, 512000);
        assert_eq!(info.cached_kb, 3072000);
        assert_eq!(info.swap_total_kb, 2048000);
        assert_eq!(info.swap_free_kb, 1024000);
    }

    #[test]
    fn test_parse_meminfo_empty() {
        let info = parse_meminfo("");
        assert_eq!(info.total_kb, 0);
        assert_eq!(info.available_kb, 0);
    }

    #[test]
    fn test_parse_net_dev() {
        let raw = "Inter-|   Receive                                                |  Transmit\n\
                   face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n\
                   eth0: 1000000    1500    0    1    0     0          0         0   500000    1200    0    2    0     0       0          0\n\
                   lo:    50000     200    0    0    0     0          0         0    50000     200    0    0    0     0       0          0";
        let map = parse_net_dev(raw);
        assert_eq!(map.len(), 2);
        let eth0 = map.get("eth0").unwrap();
        assert_eq!(eth0.rx_bytes, 1000000);
        assert_eq!(eth0.tx_bytes, 500000);
        assert_eq!(eth0.rx_packets, 1500);
        assert_eq!(eth0.tx_packets, 1200);
        assert_eq!(eth0.rx_drop, 1);
        assert_eq!(eth0.tx_drop, 2);
    }

    #[test]
    fn test_parse_tcp_snmp() {
        let raw = "Tcp: RtoAlgorithm RtoMin RtoMax MaxConn ActiveOpens PassiveOpens AttemptFails EstabResets CurrEstab InSegs OutSegs RetransSegs InErrs OutRsts InCsumErrors\n\
                   Tcp: 1 200 120000 -1 1234 5678 12 34 5 100000 120000 300 0 45 0";
        let snmp = parse_tcp_snmp(raw);
        assert_eq!(snmp.out_segs, 120000);
        assert_eq!(snmp.retrans_segs, 300);
    }

    #[test]
    fn test_rounding_helpers() {
        assert_eq!(round1(1.26), 1.3);
        assert_eq!(round2(1.236), 1.24);
        assert_eq!(round3(1.2346), 1.235);
        assert_eq!(round4(1.23456), 1.2346);
    }
}
