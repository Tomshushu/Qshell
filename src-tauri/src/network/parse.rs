use super::domain::*;
use regex::Regex;
use std::sync::LazyLock;

static SS_PROCESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"users:\(\("([^"]+)",pid=(\d+)"#).unwrap()
});

static SS_USER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"users:\(\("([^"]+)""#).unwrap()
});

static PING_STATS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(\d+)\s+packets\s+transmitted,\s+(\d+)\s+(?:packets\s+)?received.*?(?:([0-9.]+)%\s+packet\s+loss)"#).unwrap()
});

static PING_RTT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?:rtt|round-trip)\s+min/avg/max/(?:mdev|stddev)\s*=\s*([0-9.]+)/([0-9.]+)/([0-9.]+)/([0-9.]+)"#).unwrap()
});

// ==================== Interfaces & Addresses ====================

/// 解析网络接口信息（支持 ip -j -s link 与文本回退）
pub fn parse_interfaces(link_output: &str, addr_output: &str) -> Vec<InterfaceInfo> {
    let mut map: std::collections::BTreeMap<String, InterfaceInfo> = std::collections::BTreeMap::new();

    // 1. 解析 link 输出（优先 JSON，回退文本）
    if link_output.trim().starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(link_output) {
            for item in items {
                let name = item["ifname"].as_str().unwrap_or("").to_string();
                if name.is_empty() {
                    continue;
                }
                let mac = item["address"].as_str().unwrap_or("").to_string();
                let operstate = item["operstate"].as_str().unwrap_or("UNKNOWN").to_uppercase();
                let flags: Vec<String> = item["flags"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                let mtu = item["mtu"].as_u64().unwrap_or(1500) as u32;

                let stats = &item["stats64"];
                let stats = if stats.is_object() { stats } else { &item["stats"] };

                let rx_bytes = stats["rx"]["bytes"].as_u64().unwrap_or(0);
                let tx_bytes = stats["tx"]["bytes"].as_u64().unwrap_or(0);
                let rx_packets = stats["rx"]["packets"].as_u64().unwrap_or(0);
                let tx_packets = stats["tx"]["packets"].as_u64().unwrap_or(0);
                let rx_errors = stats["rx"]["errors"].as_u64().unwrap_or(0);
                let tx_errors = stats["tx"]["errors"].as_u64().unwrap_or(0);
                let rx_dropped = stats["rx"]["dropped"].as_u64().unwrap_or(0);
                let tx_dropped = stats["tx"]["dropped"].as_u64().unwrap_or(0);

                let state = if operstate == "UP" || flags.iter().any(|f| f == "UP") {
                    "UP".to_string()
                } else {
                    "DOWN".to_string()
                };

                map.insert(name.clone(), InterfaceInfo {
                    name,
                    index: item["ifindex"].as_u64().map(|idx| idx as u32),
                    mac,
                    flags,
                    mtu,
                    state,
                    operstate,
                    ipv4: Vec::new(),
                    ipv6: Vec::new(),
                    rx_bytes,
                    tx_bytes,
                    rx_packets,
                    tx_packets,
                    rx_errors,
                    tx_errors,
                    rx_dropped,
                    tx_dropped,
                    speed: None,
                    duplex: None,
                });
            }
        }
    }

    // 文本回退：如果 JSON 解析为空，解析文本格式 `ip -s link` 或 `ip link`
    if map.is_empty() {
        let lines: Vec<&str> = link_output.lines().collect();
        let mut i = 0;
        while i < lines.len() {
            let line = lines[i].trim();
            if line.is_empty() {
                i += 1;
                continue;
            }

            // 格式：1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
            if let Some((idx_str, rest)) = line.split_once(':') {
                if let Ok(idx) = idx_str.trim().parse::<u32>() {
                    if let Some((name_part, flag_part)) = rest.split_once(':') {
                        let ifname = name_part.trim().to_string();
                        let mut flags = Vec::new();
                        let mut mtu = 1500;
                        let mut operstate = "UNKNOWN".to_string();

                        if let Some(flag_start) = flag_part.find('<') {
                            if let Some(flag_end) = flag_part.find('>') {
                                flags = flag_part[flag_start + 1..flag_end]
                                    .split(',')
                                    .map(|s| s.trim().to_string())
                                    .collect();
                            }
                        }

                        for part in flag_part.split_whitespace() {
                            if part == "mtu" {
                                // next word
                            }
                        }
                        let tokens: Vec<&str> = flag_part.split_whitespace().collect();
                        for (t_idx, &t) in tokens.iter().enumerate() {
                            if t == "mtu" && t_idx + 1 < tokens.len() {
                                mtu = tokens[t_idx + 1].parse().unwrap_or(1500);
                            }
                            if t == "state" && t_idx + 1 < tokens.len() {
                                operstate = tokens[t_idx + 1].to_uppercase();
                            }
                        }

                        let mut mac = String::new();
                        let mut rx_bytes = 0;
                        let mut tx_bytes = 0;
                        let mut rx_packets = 0;
                        let mut tx_packets = 0;
                        let mut rx_errors = 0;
                        let mut tx_errors = 0;
                        let mut rx_dropped = 0;
                        let mut tx_dropped = 0;

                        // Check subsequent lines for link/ether and RX/TX stats
                        let mut j = i + 1;
                        while j < lines.len() && !lines[j].starts_with(|c: char| c.is_ascii_digit()) {
                            let subline = lines[j].trim();
                            if subline.starts_with("link/ether") || subline.starts_with("link/loopback") {
                                let parts: Vec<&str> = subline.split_whitespace().collect();
                                if parts.len() > 1 {
                                    mac = parts[1].to_string();
                                }
                            } else if subline.starts_with("RX:") {
                                // Next line contains RX numbers
                                if j + 1 < lines.len() {
                                    let nums: Vec<&str> = lines[j + 1].split_whitespace().collect();
                                    if nums.len() >= 4 {
                                        rx_bytes = nums[0].parse().unwrap_or(0);
                                        rx_packets = nums[1].parse().unwrap_or(0);
                                        rx_errors = nums[2].parse().unwrap_or(0);
                                        rx_dropped = nums[3].parse().unwrap_or(0);
                                    }
                                }
                            } else if subline.starts_with("TX:")
                                && j + 1 < lines.len() {
                                    let nums: Vec<&str> = lines[j + 1].split_whitespace().collect();
                                    if nums.len() >= 4 {
                                        tx_bytes = nums[0].parse().unwrap_or(0);
                                        tx_packets = nums[1].parse().unwrap_or(0);
                                        tx_errors = nums[2].parse().unwrap_or(0);
                                        tx_dropped = nums[3].parse().unwrap_or(0);
                                    }
                                }
                            j += 1;
                        }

                        let state = if operstate == "UP" || flags.iter().any(|f| f == "UP") {
                            "UP".to_string()
                        } else {
                            "DOWN".to_string()
                        };

                        map.insert(ifname.clone(), InterfaceInfo {
                            name: ifname,
                            index: Some(idx),
                            mac,
                            flags,
                            mtu,
                            state,
                            operstate,
                            ipv4: Vec::new(),
                            ipv6: Vec::new(),
                            rx_bytes,
                            tx_bytes,
                            rx_packets,
                            tx_packets,
                            rx_errors,
                            tx_errors,
                            rx_dropped,
                            tx_dropped,
                            speed: None,
                            duplex: None,
                        });
                        i = j - 1;
                    }
                }
            }
            i += 1;
        }
    }

    // 2. 合并 addr 输出
    if addr_output.trim().starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(addr_output) {
            for item in items {
                let name = item["ifname"].as_str().unwrap_or("");
                if let Some(iface) = map.get_mut(name) {
                    if let Some(addr_infos) = item["addr_info"].as_array() {
                        for addr in addr_infos {
                            let family = addr["family"].as_str().unwrap_or("");
                            let local = addr["local"].as_str().unwrap_or("");
                            let prefixlen = addr["prefixlen"].as_u64().unwrap_or(32);
                            if !local.is_empty() {
                                let cidr = format!("{}/{}", local, prefixlen);
                                if family == "inet" {
                                    if !iface.ipv4.contains(&cidr) {
                                        iface.ipv4.push(cidr);
                                    }
                                } else if family == "inet6"
                                    && !iface.ipv6.contains(&cidr) {
                                        iface.ipv6.push(cidr);
                                    }
                            }
                        }
                    }
                }
            }
        }
    } else {
        // 文本解析 ip addr
        let mut cur_iface: Option<&mut InterfaceInfo> = None;
        for line in addr_output.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if !line.starts_with(' ') && !line.starts_with('\t') {
                // Interface header e.g. "2: eth0: <BROADCAST...>"
                if let Some((_, rest)) = trimmed.split_once(':') {
                    if let Some((ifname, _)) = rest.split_once(':') {
                        let name = ifname.trim();
                        cur_iface = map.get_mut(name);
                    }
                }
            } else if let Some(ref mut iface) = cur_iface {
                if trimmed.starts_with("inet ") {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() > 1 {
                        let cidr = parts[1].to_string();
                        if !iface.ipv4.contains(&cidr) {
                            iface.ipv4.push(cidr);
                        }
                    }
                } else if trimmed.starts_with("inet6 ") {
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() > 1 {
                        let cidr = parts[1].to_string();
                        if !iface.ipv6.contains(&cidr) {
                            iface.ipv6.push(cidr);
                        }
                    }
                }
            }
        }
    }

    map.into_values().collect()
}

// ==================== Routes ====================

/// 解析路由表输出
pub fn parse_routes(output: &str) -> RouteView {
    let mut routes = Vec::new();
    let mut default_gateway = None;
    let mut default_iface = None;

    if output.trim().starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(output) {
            for item in items {
                let dst = item["dst"].as_str().unwrap_or("default").to_string();
                let gateway = item["gateway"].as_str().map(|s| s.to_string());
                let dev = item["dev"].as_str().unwrap_or("").to_string();
                let metric = item["metric"].as_i64().map(|m| m as i32);
                let protocol = item["protocol"].as_str().map(|s| s.to_string());
                let scope = item["scope"].as_str().map(|s| s.to_string());
                let is_default = dst == "default";

                if is_default && default_gateway.is_none() {
                    default_gateway = gateway.clone();
                    default_iface = Some(dev.clone());
                }

                routes.push(RouteInfo {
                    destination: dst,
                    gateway,
                    genmask: None,
                    iface: dev,
                    metric,
                    scope,
                    protocol,
                    is_default,
                });
            }
        }
    }

    if routes.is_empty() {
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Text e.g. "default via 192.168.1.1 dev eth0 proto dhcp metric 100"
            // or "192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.50"
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.is_empty() {
                continue;
            }

            let destination = tokens[0].to_string();
            let is_default = destination == "default";
            let mut gateway = None;
            let mut iface = String::new();
            let mut metric = None;
            let mut protocol = None;
            let mut scope = None;

            for (idx, &token) in tokens.iter().enumerate() {
                if token == "via" && idx + 1 < tokens.len() {
                    gateway = Some(tokens[idx + 1].to_string());
                } else if token == "dev" && idx + 1 < tokens.len() {
                    iface = tokens[idx + 1].to_string();
                } else if token == "metric" && idx + 1 < tokens.len() {
                    metric = tokens[idx + 1].parse().ok();
                } else if token == "proto" && idx + 1 < tokens.len() {
                    protocol = Some(tokens[idx + 1].to_string());
                } else if token == "scope" && idx + 1 < tokens.len() {
                    scope = Some(tokens[idx + 1].to_string());
                }
            }

            if is_default && default_gateway.is_none() {
                default_gateway = gateway.clone();
                default_iface = Some(iface.clone());
            }

            routes.push(RouteInfo {
                destination,
                gateway,
                genmask: None,
                iface,
                metric,
                scope,
                protocol,
                is_default,
            });
        }
    }

    RouteView {
        routes,
        default_gateway,
        default_iface,
    }
}

/// 解析 ip route get <target> 输出
pub fn parse_route_get(target: &str, output: &str) -> RouteGetResult {
    // 文本如: "1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.50 uid 1000"
    // 或直接连通目标 "192.168.1.100 dev eth0 src 192.168.1.50 uid 1000"
    let mut gateway = None;
    let mut iface = String::new();
    let mut src_ip = None;

    if output.trim().starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(output) {
            if let Some(item) = items.first() {
                gateway = item["gateway"].as_str().map(|s| s.to_string());
                iface = item["dev"].as_str().unwrap_or("").to_string();
                src_ip = item["prefsrc"].as_str().map(|s| s.to_string());
            }
        }
    }

    if iface.is_empty() {
        let tokens: Vec<&str> = output.split_whitespace().collect();
        for (idx, &token) in tokens.iter().enumerate() {
            if token == "via" && idx + 1 < tokens.len() {
                let mut gw = tokens[idx + 1];
                if let Some(pct) = gw.find('%') {
                    gw = &gw[..pct];
                }
                gateway = Some(gw.to_string());
            } else if token == "dev" && idx + 1 < tokens.len() {
                iface = tokens[idx + 1].to_string();
            } else if token == "src" && idx + 1 < tokens.len() {
                let mut src = tokens[idx + 1];
                if let Some(pct) = src.find('%') {
                    src = &src[..pct];
                }
                src_ip = Some(src.to_string());
            }
        }
    }

    RouteGetResult {
        destination: target.to_string(),
        gateway,
        iface,
        src_ip,
        raw: output.trim().to_string(),
    }
}

// ==================== DNS Config ====================

/// 解析 /etc/resolv.conf 与 resolvectl status
pub fn parse_dns_config(resolv_output: &str, resolvectl_output: &str) -> DnsConfigInfo {
    let mut nameservers = Vec::new();
    let mut search_domains = Vec::new();
    let mut options = Vec::new();

    for line in resolv_output.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        match parts[0] {
            "nameserver" => {
                if parts.len() > 1 {
                    let mut ns = parts[1].to_string();
                    if let Some(pct) = ns.find('%') {
                        ns.truncate(pct);
                    }
                    if !nameservers.contains(&ns) {
                        nameservers.push(ns);
                    }
                }
            }
            "search" | "domain" => {
                for &d in parts[1..].iter() {
                    let domain = d.to_string();
                    if !search_domains.contains(&domain) {
                        search_domains.push(domain);
                    }
                }
            }
            "options" => {
                for &opt in parts[1..].iter() {
                    options.push(opt.to_string());
                }
            }
            _ => {}
        }
    }

    // 从 resolvectl status 补充真实 DNS 服务器（针对 systemd-resolved 机器中 resolv.conf 仅为 127.0.0.53 的情况）
    let mut source = "/etc/resolv.conf".to_string();
    if !resolvectl_output.trim().is_empty() {
        for line in resolvectl_output.lines() {
            let line = line.trim();
            if line.contains("DNS Servers:") || line.contains("Current DNS Server:") {
                if let Some((_, servers_part)) = line.split_once(':') {
                    for s in servers_part.split_whitespace() {
                        let mut s = s.trim();
                        if let Some(pct) = s.find('%') {
                            s = &s[..pct];
                        }
                        let s = s.to_string();
                        if !s.is_empty() && !nameservers.contains(&s) && s != "127.0.0.53" {
                            nameservers.push(s);
                            source = "systemd-resolved".to_string();
                        }
                    }
                }
            }
        }
    }

    DnsConfigInfo {
        nameservers,
        search_domains,
        options,
        source,
    }
}

// ==================== Sockets & Connections ====================

/// 解析 ss -tulpn (listening) 与 ss -tunap (all) 输出
pub fn parse_sockets(output: &str) -> Vec<SocketInfo> {
    let mut sockets = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Netid") || line.starts_with("State") {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        // ss columns usually:
        // [0] Netid (tcp/udp)
        // [1] State (LISTEN, ESTAB, etc.)
        // [2] Recv-Q
        // [3] Send-Q
        // [4] Local Address:Port
        // [5] Peer Address:Port
        // [6..] Process
        if parts.len() < 6 {
            continue;
        }

        let protocol = parts[0].to_lowercase();
        let state = parts[1].to_uppercase();
        let (local_address, local_port) = parse_address_port(parts[4]);
        let (foreign_address, foreign_port) = parse_address_port(parts[5]);

        let mut pid = None;
        let mut process_name = None;

        if parts.len() >= 7 {
            let proc_str = parts[6..].join(" ");
            if let Some(caps) = SS_PROCESS_RE.captures(&proc_str) {
                process_name = Some(caps[1].to_string());
                pid = caps[2].parse().ok();
            } else if let Some(caps) = SS_USER_RE.captures(&proc_str) {
                process_name = Some(caps[1].to_string());
            }
        }

        sockets.push(SocketInfo {
            protocol,
            local_address,
            local_port,
            foreign_address,
            foreign_port,
            state,
            pid,
            process_name,
            user: None,
        });
    }

    sockets
}

fn parse_address_port(raw: &str) -> (String, u16) {
    let raw = raw.trim();
    if raw == "*:*" || raw == "*:0" || raw == "*:" {
        return ("*".to_string(), 0);
    }

    // Handle bracketed IPv6: [address]:port or [address%ifname]:port
    if raw.starts_with('[') {
        if let Some(close_idx) = raw.find(']') {
            let mut addr = &raw[1..close_idx];
            if let Some(pct) = addr.find('%') {
                addr = &addr[..pct];
            }
            let rest = &raw[close_idx + 1..];
            let port_str = rest.strip_prefix(':').unwrap_or(rest);
            let port: u16 = port_str.parse().unwrap_or(0);
            let addr = if addr.is_empty() || addr == "*" {
                "*"
            } else {
                addr
            };
            return (addr.to_string(), port);
        }
    }

    // Unbracketed: split at the last ':'
    if let Some((addr, port_str)) = raw.rsplit_once(':') {
        let port = port_str.parse::<u16>().unwrap_or(0);
        let mut addr = addr.trim_matches('[').trim_matches(']');
        // Strip interface scope / device suffix like %lo or %eth0 (e.g. 127.0.0.53%lo -> 127.0.0.53)
        if let Some(pct) = addr.find('%') {
            addr = &addr[..pct];
        }
        let addr = if addr.is_empty() || addr == "*" {
            "*"
        } else {
            addr
        };
        (addr.to_string(), port)
    } else {
        let mut addr = raw.trim_matches('[').trim_matches(']');
        if let Some(pct) = addr.find('%') {
            addr = &addr[..pct];
        }
        (if addr.is_empty() || addr == "*" { "*".to_string() } else { addr.to_string() }, 0)
    }
}

// ==================== Neighbors / ARP ====================

/// 解析 ip neigh 输出
pub fn parse_neighbors(output: &str) -> Vec<NeighborInfo> {
    let mut neighbors = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // e.g. "192.168.1.1 dev eth0 lladdr 00:11:22:33:44:55 REACHABLE"
        // e.g. "192.168.1.2 dev eth0 FAILED"
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 3 {
            continue;
        }

        let mut ip = tokens[0];
        if let Some(pct) = ip.find('%') {
            ip = &ip[..pct];
        }
        let ip = ip.to_string();
        let mut iface = String::new();
        let mut mac = None;
        let mut state = String::new();

        for (idx, &token) in tokens.iter().enumerate() {
            if token == "dev" && idx + 1 < tokens.len() {
                iface = tokens[idx + 1].to_string();
            } else if token == "lladdr" && idx + 1 < tokens.len() {
                mac = Some(tokens[idx + 1].to_string());
            }
        }

        if let Some(last) = tokens.last() {
            state = last.to_string();
        }

        neighbors.push(NeighborInfo {
            ip,
            mac,
            iface,
            state,
        });
    }

    neighbors
}

// ==================== Ethtool Link Info ====================

/// 解析 ethtool <iface> 输出
pub fn parse_ethtool(iface: &str, output: &str) -> EthtoolInfo {
    let mut info = EthtoolInfo {
        iface: iface.to_string(),
        ..Default::default()
    };

    for line in output.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            let val = v.trim();
            match key {
                "Speed" => info.speed = Some(val.to_string()),
                "Duplex" => info.duplex = Some(val.to_string()),
                "Port" => info.port = Some(val.to_string()),
                "Auto-negotiation" => info.auto_negotiation = Some(val.to_string()),
                "Link detected" => info.link_detected = Some(val.eq_ignore_ascii_case("yes")),
                "driver" => info.driver = Some(val.to_string()),
                _ => {}
            }
        }
    }

    info
}

// ==================== Ping & Traceroute ====================

#[derive(Debug, Clone, Default)]
pub struct PingStats {
    pub transmitted: u32,
    pub received: u32,
    pub loss_percent: f64,
    pub min_rtt: Option<f64>,
    pub avg_rtt: Option<f64>,
    pub max_rtt: Option<f64>,
    pub mdev_rtt: Option<f64>,
}

pub fn parse_ping(output: &str) -> PingStats {
    let mut stats = PingStats::default();

    if let Some(caps) = PING_STATS_RE.captures(output) {
        stats.transmitted = caps[1].parse().unwrap_or(0);
        stats.received = caps[2].parse().unwrap_or(0);
        stats.loss_percent = caps[3].parse().unwrap_or(0.0);
    }

    if let Some(caps) = PING_RTT_RE.captures(output) {
        stats.min_rtt = caps[1].parse().ok();
        stats.avg_rtt = caps[2].parse().ok();
        stats.max_rtt = caps[3].parse().ok();
        stats.mdev_rtt = caps[4].parse().ok();
    }

    stats
}

#[derive(Debug, Clone, Default)]
pub struct CurlTiming {
    pub http_code: u16,
    pub time_namelookup_ms: f64,
    pub time_connect_ms: f64,
    pub time_appconnect_ms: f64,
    pub time_starttransfer_ms: f64,
    pub time_total_ms: f64,
    pub remote_ip: String,
}

pub fn parse_curl_timing(output: &str) -> Option<CurlTiming> {
    let lines: Vec<&str> = output.trim().lines().collect();
    if lines.len() < 6 {
        return None;
    }

    let http_code = lines[0].trim().parse::<u16>().unwrap_or(0);
    let time_namelookup_ms = lines[1].trim().parse::<f64>().unwrap_or(0.0) * 1000.0;
    let time_connect_ms = lines[2].trim().parse::<f64>().unwrap_or(0.0) * 1000.0;
    let time_appconnect_ms = lines[3].trim().parse::<f64>().unwrap_or(0.0) * 1000.0;
    let time_starttransfer_ms = lines[4].trim().parse::<f64>().unwrap_or(0.0) * 1000.0;
    let time_total_ms = lines[5].trim().parse::<f64>().unwrap_or(0.0) * 1000.0;
    let remote_ip = if lines.len() > 6 { lines[6].trim().to_string() } else { String::new() };

    Some(CurlTiming {
        http_code,
        time_namelookup_ms,
        time_connect_ms,
        time_appconnect_ms,
        time_starttransfer_ms,
        time_total_ms,
        remote_ip,
    })
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_interfaces_json() {
        let link_json = r#"[
            {
                "ifindex": 1,
                "ifname": "lo",
                "flags": ["LOOPBACK", "UP", "LOWER_UP"],
                "mtu": 65536,
                "operstate": "UNKNOWN",
                "address": "00:00:00:00:00:00",
                "stats64": {
                    "rx": { "bytes": 1000, "packets": 10, "errors": 0, "dropped": 0 },
                    "tx": { "bytes": 1000, "packets": 10, "errors": 0, "dropped": 0 }
                }
            },
            {
                "ifindex": 2,
                "ifname": "eth0",
                "flags": ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"],
                "mtu": 1500,
                "operstate": "UP",
                "address": "52:54:00:12:34:56",
                "stats64": {
                    "rx": { "bytes": 1048576, "packets": 500, "errors": 2, "dropped": 1 },
                    "tx": { "bytes": 2097152, "packets": 800, "errors": 0, "dropped": 0 }
                }
            }
        ]"#;

        let addr_json = r#"[
            {
                "ifname": "eth0",
                "addr_info": [
                    { "family": "inet", "local": "192.168.1.100", "prefixlen": 24 },
                    { "family": "inet6", "local": "fe80::1", "prefixlen": 64 }
                ]
            }
        ]"#;

        let ifaces = parse_interfaces(link_json, addr_json);
        assert_eq!(ifaces.len(), 2);

        let eth0 = ifaces.iter().find(|i| i.name == "eth0").unwrap();
        assert_eq!(eth0.state, "UP");
        assert_eq!(eth0.mtu, 1500);
        assert_eq!(eth0.mac, "52:54:00:12:34:56");
        assert_eq!(eth0.ipv4, vec!["192.168.1.100/24"]);
        assert_eq!(eth0.ipv6, vec!["fe80::1/64"]);
        assert_eq!(eth0.rx_bytes, 1048576);
        assert_eq!(eth0.rx_errors, 2);
    }

    #[test]
    fn test_parse_routes_text() {
        let text = "\
default via 192.168.1.1 dev eth0 proto dhcp metric 100 
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100 
172.17.0.0/16 dev docker0 proto kernel scope link src 172.17.0.1 linkdown";

        let view = parse_routes(text);
        assert_eq!(view.routes.len(), 3);
        assert_eq!(view.default_gateway, Some("192.168.1.1".to_string()));
        assert_eq!(view.default_iface, Some("eth0".to_string()));
        assert!(view.routes[0].is_default);
        assert_eq!(view.routes[0].metric, Some(100));
    }

    #[test]
    fn test_parse_route_get() {
        let text = "1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.100 uid 1000\n    cache";
        let res = parse_route_get("1.1.1.1", text);
        assert_eq!(res.destination, "1.1.1.1");
        assert_eq!(res.gateway, Some("192.168.1.1".to_string()));
        assert_eq!(res.iface, "eth0");
        assert_eq!(res.src_ip, Some("192.168.1.100".to_string()));
    }

    #[test]
    fn test_parse_dns_config() {
        let resolv = "\
# This file was generated by NetworkManager
search localdomain example.com
nameserver 1.1.1.1
nameserver 8.8.8.8
options edns0 trust-ad";

        let resolvectl = "\
Link 2 (eth0):
    Current DNS Server: 192.168.1.1%eth0
           DNS Servers: 192.168.1.1%eth0 127.0.0.53%lo 1.0.0.1%eth0";

        let config = parse_dns_config(resolv, resolvectl);
        assert_eq!(config.nameservers, vec!["1.1.1.1", "8.8.8.8", "192.168.1.1", "1.0.0.1"]);
        assert_eq!(config.search_domains, vec!["localdomain", "example.com"]);
        assert_eq!(config.options, vec!["edns0", "trust-ad"]);
    }

    #[test]
    fn test_parse_sockets() {
        let ss_output = "\
Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
tcp   LISTEN 0      128    0.0.0.0:22          0.0.0.0:*         users:((\"sshd\",pid=982,fd=3))
tcp   LISTEN 0      511    0.0.0.0:80          0.0.0.0:*         users:((\"nginx\",pid=1234,fd=6))
tcp   ESTAB  0      0      192.168.1.100:22    192.168.1.50:54321 users:((\"sshd\",pid=1980,fd=4))
udp   UNCONN 0      0      0.0.0.0:5353        0.0.0.0:*         users:((\"avahi-daemon\",pid=650,fd=12))
udp   UNCONN 0      0      127.0.0.53%lo:53    0.0.0.0:*         users:((\"systemd-resolve\",pid=538,fd=13))
tcp   LISTEN 0      128    [fe80::1%eth0]:22   [::]:*            users:((\"sshd\",pid=982,fd=4))";

        let sockets = parse_sockets(ss_output);
        assert_eq!(sockets.len(), 6);

        let ssh_listen = &sockets[0];
        assert_eq!(ssh_listen.protocol, "tcp");
        assert_eq!(ssh_listen.state, "LISTEN");
        assert_eq!(ssh_listen.local_port, 22);
        assert_eq!(ssh_listen.pid, Some(982));
        assert_eq!(ssh_listen.process_name, Some("sshd".to_string()));

        let estab = &sockets[2];
        assert_eq!(estab.state, "ESTAB");
        assert_eq!(estab.foreign_address, "192.168.1.50");
        assert_eq!(estab.foreign_port, 54321);

        let systemd_dns = &sockets[4];
        assert_eq!(systemd_dns.local_address, "127.0.0.53");
        assert_eq!(systemd_dns.local_port, 53);
        assert_eq!(systemd_dns.process_name, Some("systemd-resolve".to_string()));

        let ipv6_scoped = &sockets[5];
        assert_eq!(ipv6_scoped.local_address, "fe80::1");
        assert_eq!(ipv6_scoped.local_port, 22);
    }

    #[test]
    fn test_parse_ping() {
        let ping_out = "\
PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=14.2 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=117 time=13.8 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=117 time=14.5 ms

--- 8.8.8.8 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 13.812/14.171/14.502/0.282 ms";

        let stats = parse_ping(ping_out);
        assert_eq!(stats.transmitted, 3);
        assert_eq!(stats.received, 3);
        assert_eq!(stats.loss_percent, 0.0);
        assert_eq!(stats.min_rtt, Some(13.812));
        assert_eq!(stats.avg_rtt, Some(14.171));
        assert_eq!(stats.max_rtt, Some(14.502));
    }

    #[test]
    fn test_parse_curl_timing() {
        let curl_out = "200\n0.012\n0.024\n0.055\n0.082\n0.105\n93.184.216.34\n";
        let timing = parse_curl_timing(curl_out).unwrap();
        assert_eq!(timing.http_code, 200);
        assert_eq!(timing.time_namelookup_ms, 12.0);
        assert_eq!(timing.time_connect_ms, 24.0);
        assert_eq!(timing.time_appconnect_ms, 55.0);
        assert_eq!(timing.time_starttransfer_ms, 82.0);
        assert_eq!(timing.time_total_ms, 105.0);
        assert_eq!(timing.remote_ip, "93.184.216.34");
    }
}
