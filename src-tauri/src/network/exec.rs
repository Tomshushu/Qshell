use super::domain::*;
use super::parse::*;
use crate::commands::ssh_execute_command_with_timeout;
use crate::validators::validate_host_or_ip;
use chrono::Utc;
use std::collections::HashMap;
use std::net::IpAddr;
use std::str::FromStr;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

static CAP_CACHE: LazyLock<Mutex<HashMap<String, HostCapabilities>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// ==================== Validation ====================

pub fn validate_target(s: &str) -> Result<(), String> {
    let res = validate_host_or_ip(s.to_string());
    if !res.valid {
        return Err(res.error.unwrap_or_else(|| "Invalid target host or IP".to_string()));
    }
    // Prohibit shell characters
    for ch in [';', '|', '&', '$', '`', '\n', '\r', '(', ')', '{', '}', '<', '>'] {
        if s.contains(ch) {
            return Err("Target contains illegal shell characters".to_string());
        }
    }
    Ok(())
}

pub fn validate_iface(s: &str) -> Result<(), String> {
    if s.is_empty() || s.len() > 20 {
        return Err("Interface name length must be between 1 and 20".to_string());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || c == '@') {
        return Err("Interface name contains invalid characters".to_string());
    }
    Ok(())
}

pub fn validate_filter(s: &str) -> Result<(), String> {
    for ch in [';', '|', '&', '$', '`', '\n', '\r', '<', '>'] {
        if s.contains(ch) {
            return Err("Capture filter contains illegal shell characters".to_string());
        }
    }
    Ok(())
}

// ==================== Capabilities ====================

pub async fn detect_capabilities(server_id: &str, refresh: bool) -> HostCapabilities {
    if !refresh {
        if let Ok(cache) = CAP_CACHE.lock() {
            if let Some(caps) = cache.get(server_id) {
                return caps.clone();
            }
        }
    }

    let cmd = "\
command -v ip ss conntrack tcpdump mtr traceroute ethtool curl ping sudo 2>&1; \
echo '---'; \
ip -V 2>&1";

    let res = ssh_execute_command_with_timeout(server_id, cmd, 10).await;
    let parts: Vec<&str> = res.stdout.split("---").collect();
    let bin_output = parts.first().copied().unwrap_or("");
    let ip_ver = parts.get(1).copied().unwrap_or("");

    let has_iproute2 = bin_output.lines().any(|l| l.ends_with("/ip") || l.trim() == "ip");
    let has_ss = bin_output.lines().any(|l| l.ends_with("/ss") || l.trim() == "ss");
    let has_conntrack = bin_output.lines().any(|l| l.ends_with("/conntrack") || l.trim() == "conntrack");
    let has_tcpdump = bin_output.lines().any(|l| l.ends_with("/tcpdump") || l.trim() == "tcpdump");
    let has_mtr = bin_output.lines().any(|l| l.ends_with("/mtr") || l.trim() == "mtr");
    let has_traceroute = bin_output.lines().any(|l| l.ends_with("/traceroute") || l.trim() == "traceroute");
    let has_ethtool = bin_output.lines().any(|l| l.ends_with("/ethtool") || l.trim() == "ethtool");
    let has_curl = bin_output.lines().any(|l| l.ends_with("/curl") || l.trim() == "curl");
    let can_icmp = bin_output.lines().any(|l| l.ends_with("/ping") || l.trim() == "ping");
    let can_capture = has_tcpdump;

    // iproute2 version check for -json support (iproute2-ss180129+ supports -j)
    let ip_json = has_iproute2 && (ip_ver.contains("iproute2-") || ip_ver.contains("ip utility"));

    let caps = HostCapabilities {
        has_iproute2,
        ip_json,
        has_ss,
        has_conntrack,
        has_tcpdump,
        has_mtr,
        has_traceroute,
        has_ethtool,
        has_curl,
        can_icmp,
        can_capture,
    };

    if let Ok(mut cache) = CAP_CACHE.lock() {
        cache.insert(server_id.to_string(), caps.clone());
    }

    caps
}

// ==================== Fact Gathering ====================

pub async fn get_overview(server_id: &str) -> Result<NetOverview, String> {
    let caps = detect_capabilities(server_id, false).await;

    let cmd = "\
ip -j -s link show 2>/dev/null || ip -s link 2>/dev/null; \
echo '===ADDR==='; \
ip -j addr show 2>/dev/null || ip addr 2>/dev/null; \
echo '===ROUTE==='; \
ip -j route show 2>/dev/null || ip route 2>/dev/null; \
echo '===RESOLV==='; \
cat /etc/resolv.conf 2>/dev/null; \
echo '===RESOLVECTL==='; \
resolvectl status 2>/dev/null || systemd-resolve --status 2>/dev/null; \
echo '===SS==='; \
ss -tulpn 2>/dev/null; \
echo '===SS_ALL==='; \
ss -tunap 2>/dev/null";

    let res = ssh_execute_command_with_timeout(server_id, cmd, 15).await;

    let mut link_part = "";
    let mut addr_part = "";
    let mut route_part = "";
    let mut resolv_part = "";
    let mut resolvectl_part = "";
    let mut ss_part = "";
    let mut ss_all_part = "";

    for section in res.stdout.split("===ADDR===") {
        if link_part.is_empty() {
            link_part = section;
        } else {
            let mut sub = section.split("===ROUTE===");
            addr_part = sub.next().unwrap_or("");
            if let Some(rest) = sub.next() {
                let mut sub2 = rest.split("===RESOLV===");
                route_part = sub2.next().unwrap_or("");
                if let Some(rest2) = sub2.next() {
                    let mut sub3 = rest2.split("===RESOLVECTL===");
                    resolv_part = sub3.next().unwrap_or("");
                    if let Some(rest3) = sub3.next() {
                        let mut sub4 = rest3.split("===SS===");
                        resolvectl_part = sub4.next().unwrap_or("");
                        if let Some(rest4) = sub4.next() {
                            let mut sub5 = rest4.split("===SS_ALL===");
                            ss_part = sub5.next().unwrap_or("");
                            ss_all_part = sub5.next().unwrap_or("");
                        }
                    }
                }
            }
        }
    }

    let interfaces = parse_interfaces(link_part, addr_part);
    let route_view = parse_routes(route_part);
    let dns_config = parse_dns_config(resolv_part, resolvectl_part);
    let listening_sockets = parse_sockets(ss_part);
    let all_sockets = parse_sockets(ss_all_part);

    let established_conn_count = all_sockets.iter().filter(|s| s.state == "ESTAB").count();
    let recent_runs = super::store::list_runs(server_id, 5).unwrap_or_default();

    Ok(NetOverview {
        interfaces,
        default_gateway: route_view.default_gateway,
        default_iface: route_view.default_iface,
        dns_servers: dns_config.nameservers,
        listening_ports_count: listening_sockets.len(),
        established_conn_count,
        capabilities: caps,
        recent_runs,
    })
}

pub async fn get_interfaces(server_id: &str) -> Result<Vec<InterfaceInfo>, String> {
    let cmd = "ip -j -s link show 2>/dev/null || ip -s link 2>/dev/null; echo '===ADDR==='; ip -j addr show 2>/dev/null || ip addr 2>/dev/null";
    let res = ssh_execute_command_with_timeout(server_id, cmd, 10).await;
    let parts: Vec<&str> = res.stdout.split("===ADDR===").collect();
    let link_out = parts.first().copied().unwrap_or("");
    let addr_out = parts.get(1).copied().unwrap_or("");
    Ok(parse_interfaces(link_out, addr_out))
}

pub async fn get_routes(server_id: &str) -> Result<RouteView, String> {
    let cmd = "ip -j route show 2>/dev/null || ip route 2>/dev/null";
    let res = ssh_execute_command_with_timeout(server_id, cmd, 8).await;
    Ok(parse_routes(&res.stdout))
}

pub async fn get_route_get(server_id: &str, target: &str) -> Result<RouteGetResult, String> {
    validate_target(target)?;
    let cmd = format!("ip -j route get {0} 2>/dev/null || ip route get {0} 2>/dev/null", target);
    let res = ssh_execute_command_with_timeout(server_id, &cmd, 8).await;
    Ok(parse_route_get(target, &res.stdout))
}

pub async fn get_dns_config(server_id: &str) -> Result<DnsConfigInfo, String> {
    let cmd = "cat /etc/resolv.conf 2>/dev/null; echo '===RESOLVECTL==='; resolvectl status 2>/dev/null || systemd-resolve --status 2>/dev/null";
    let res = ssh_execute_command_with_timeout(server_id, cmd, 8).await;
    let parts: Vec<&str> = res.stdout.split("===RESOLVECTL===").collect();
    let resolv = parts.first().copied().unwrap_or("");
    let resolvectl = parts.get(1).copied().unwrap_or("");
    Ok(parse_dns_config(resolv, resolvectl))
}

pub async fn get_connections(server_id: &str, query: Option<ConnQuery>) -> Result<ConnPage, String> {
    let cmd = "ss -tunap 2>/dev/null || netstat -tunap 2>/dev/null";
    let res = ssh_execute_command_with_timeout(server_id, cmd, 10).await;
    let sockets = parse_sockets(&res.stdout);

    let mut listening_count = 0;
    let mut established_count = 0;
    let mut other_count = 0;

    for s in &sockets {
        if s.state == "LISTEN" {
            listening_count += 1;
        } else if s.state == "ESTAB" {
            established_count += 1;
        } else {
            other_count += 1;
        }
    }

    let q = query.unwrap_or_default();
    let filter_text = q.filter.unwrap_or_default().to_lowercase();
    let state_filter = q.state.unwrap_or_default().to_uppercase();
    let proto_filter = q.protocol.unwrap_or_default().to_lowercase();

    let filtered: Vec<SocketInfo> = sockets.into_iter().filter(|s| {
        if !state_filter.is_empty() && state_filter != "ALL" {
            if state_filter == "LISTEN" && s.state != "LISTEN" {
                return false;
            }
            if state_filter == "ESTAB" && s.state != "ESTAB" {
                return false;
            }
            if state_filter == "OTHER" && (s.state == "LISTEN" || s.state == "ESTAB") {
                return false;
            }
        }
        if !proto_filter.is_empty() && proto_filter != "all"
            && !s.protocol.contains(&proto_filter) {
                return false;
            }
        if !filter_text.is_empty() {
            let port_str = s.local_port.to_string();
            let foreign_port_str = s.foreign_port.to_string();
            let proc_str = s.process_name.as_deref().unwrap_or("").to_lowercase();
            let pid_str = s.pid.map(|p| p.to_string()).unwrap_or_default();
            if !s.local_address.contains(&filter_text)
                && !port_str.contains(&filter_text)
                && !s.foreign_address.contains(&filter_text)
                && !foreign_port_str.contains(&filter_text)
                && !proc_str.contains(&filter_text)
                && !pid_str.contains(&filter_text)
            {
                return false;
            }
        }
        true
    }).collect();

    let total = filtered.len();
    let page = q.page.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(100).min(500);
    let start = (page - 1) * page_size;
    let items = if start < total {
        filtered.into_iter().skip(start).take(page_size).collect()
    } else {
        Vec::new()
    };

    Ok(ConnPage {
        items,
        total,
        listening_count,
        established_count,
        other_count,
    })
}

pub async fn get_neighbors(server_id: &str) -> Result<Vec<NeighborInfo>, String> {
    let cmd = "ip -j neigh show 2>/dev/null || ip neigh 2>/dev/null || arp -n 2>/dev/null";
    let res = ssh_execute_command_with_timeout(server_id, cmd, 8).await;
    Ok(parse_neighbors(&res.stdout))
}

pub async fn get_ethtool(server_id: &str, iface: &str) -> Result<EthtoolInfo, String> {
    validate_iface(iface)?;
    let cmd = format!("ethtool {} 2>&1", iface);
    let res = ssh_execute_command_with_timeout(server_id, &cmd, 8).await;
    Ok(parse_ethtool(iface, &res.stdout))
}

// ==================== 6-Layer Quick Check ====================

pub async fn run_quick_check(
    app: AppHandle,
    server_id: String,
    target: String,
    port: Option<u16>,
    protocol: Option<String>,
) -> Result<NetworkRun, String> {
    validate_target(&target)?;
    let target_port = port.unwrap_or(if protocol.as_deref() == Some("https") { 443 } else { 80 });
    let proto = protocol.unwrap_or_else(|| (if target_port == 443 { "https" } else { "http" }).to_string());

    let run_id = Uuid::new_v4().to_string();
    let spec = RunSpec {
        target: target.clone(),
        port: Some(target_port),
        protocol: proto.clone(),
        timeout_ms: 30000,
    };
    let spec_fingerprint = spec.fingerprint();
    let started_at = Utc::now().timestamp_millis();

    let mut run = NetworkRun {
        id: run_id.clone(),
        server_id: server_id.clone(),
        spec,
        spec_fingerprint,
        started_at,
        finished_at: None,
        status: "running".to_string(),
        steps: Vec::new(),
        verdict: None,
    };

    let step_channel = format!("net://run/{}/step", run_id);
    let done_channel = format!("net://run/{}/done", run_id);

    let mut resolved_ip = target.clone();
    let mut first_failed_layer: Option<Layer> = None;
    let mut verdict_causes = Vec::new();
    let mut verdict_actions = Vec::new();

    // -----------------------------------------------------------------
    // Step 1: L1 DNS
    // -----------------------------------------------------------------
    let start_dns = Utc::now().timestamp_millis();
    let is_raw_ip = IpAddr::from_str(&target).is_ok();

    let mut step_dns = StepResult {
        layer: Layer::Dns.as_str().to_string(),
        name: "DNS 域名解析".to_string(),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_dns);

    if is_raw_ip {
        step_dns.status = "ok".to_string();
        step_dns.summary = Some(format!("目标已为 IP 地址 ({})，跳过 DNS", target));
        step_dns.duration_ms = Some(0);
        resolved_ip = target.clone();
    } else {
        let dns_cmd = format!("getent hosts {0} 2>&1 || dig +short {0} 2>&1 || nslookup {0} 2>&1", target);
        let dns_res = ssh_execute_command_with_timeout(&server_id, &dns_cmd, 5).await;
        let dur = (Utc::now().timestamp_millis() - start_dns).max(1) as u64;
        step_dns.duration_ms = Some(dur);
        step_dns.detail = Some(dns_res.stdout.clone());

        // Extract first valid IP
        let mut found_ip = None;
        for line in dns_res.stdout.lines() {
            let line = line.trim();
            for word in line.split_whitespace() {
                if IpAddr::from_str(word).is_ok() {
                    found_ip = Some(word.to_string());
                    break;
                }
            }
            if found_ip.is_some() {
                break;
            }
        }

        if let Some(ip) = found_ip {
            resolved_ip = ip.clone();
            step_dns.status = "ok".to_string();
            step_dns.summary = Some(format!("解析成功: {} -> {}", target, ip));
        } else {
            step_dns.status = "fail".to_string();
            step_dns.summary = Some(format!("DNS 解析失败: 未能解析 {}", target));
            step_dns.error = Some(dns_res.stderr.clone());
            if first_failed_layer.is_none() {
                first_failed_layer = Some(Layer::Dns);
                verdict_causes.push("目标域名不存在或 DNS 解析记录尚未生效".to_string());
                verdict_causes.push("目标服务器 /etc/resolv.conf 中的 nameserver 无法访问或配置错误".to_string());
                verdict_actions.push("检查域名拼写是否正确".to_string());
                verdict_actions.push("在主机上执行 `cat /etc/resolv.conf` 检查 DNS 配置，或添加 `nameserver 8.8.8.8`".to_string());
            }
        }
    }
    let _ = app.emit(&step_channel, &step_dns);
    run.steps.push(step_dns);

    // -----------------------------------------------------------------
    // Step 2: L2 Route
    // -----------------------------------------------------------------
    let start_route = Utc::now().timestamp_millis();
    let mut step_route = StepResult {
        layer: Layer::Route.as_str().to_string(),
        name: "路由优选 (Route Get)".to_string(),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_route);

    if first_failed_layer == Some(Layer::Dns) {
        step_route.status = "skipped".to_string();
        step_route.summary = Some("DNS 失败，跳过路由选路".to_string());
    } else {
        let route_cmd = format!("ip route get {} 2>&1", resolved_ip);
        let route_res = ssh_execute_command_with_timeout(&server_id, &route_cmd, 5).await;
        let dur = (Utc::now().timestamp_millis() - start_route).max(1) as u64;
        step_route.duration_ms = Some(dur);
        step_route.detail = Some(route_res.stdout.clone());

        if route_res.exit_code == 0 && !route_res.stdout.contains("unreachable") {
            let r = parse_route_get(&resolved_ip, &route_res.stdout);
            step_route.status = "ok".to_string();
            step_route.summary = Some(format!(
                "出接口: {} | 网关: {} | 源 IP: {}",
                if r.iface.is_empty() { "default" } else { &r.iface },
                r.gateway.as_deref().unwrap_or("直连"),
                r.src_ip.as_deref().unwrap_or("自动")
            ));
        } else {
            step_route.status = "fail".to_string();
            step_route.summary = Some("路由不可达: 无到达目标的主机路由".to_string());
            step_route.error = Some(route_res.stderr.clone());
            if first_failed_layer.is_none() {
                first_failed_layer = Some(Layer::Route);
                verdict_causes.push("目标主机缺少到达该网段的路由或默认网关丢失".to_string());
                verdict_causes.push("对应出接口网卡处于 DOWN 状态或未配置 IP".to_string());
                verdict_actions.push("执行 `ip route show` 确认默认网关是否存在".to_string());
                verdict_actions.push("检查路由表或通过 `ip link show` 确认网卡连接状态".to_string());
            }
        }
    }
    let _ = app.emit(&step_channel, &step_route);
    run.steps.push(step_route);

    // -----------------------------------------------------------------
    // Step 3: L3 ICMP
    // -----------------------------------------------------------------
    let start_icmp = Utc::now().timestamp_millis();
    let mut step_icmp = StepResult {
        layer: Layer::L3.as_str().to_string(),
        name: "L3 / ICMP 连通性".to_string(),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_icmp);

    if first_failed_layer == Some(Layer::Dns) || first_failed_layer == Some(Layer::Route) {
        step_icmp.status = "skipped".to_string();
        step_icmp.summary = Some("前序步骤失败，跳过 ICMP".to_string());
    } else {
        let ping_cmd = format!("ping -c 3 -W 2 {} 2>&1", resolved_ip);
        let ping_res = ssh_execute_command_with_timeout(&server_id, &ping_cmd, 8).await;
        let dur = (Utc::now().timestamp_millis() - start_icmp).max(1) as u64;
        step_icmp.duration_ms = Some(dur);
        step_icmp.detail = Some(ping_res.stdout.clone());

        let stats = parse_ping(&ping_res.stdout);
        if stats.received > 0 {
            step_icmp.status = "ok".to_string();
            step_icmp.summary = Some(format!(
                "Ping 成功: 丢包率 {:.0}% | 平均 RTT {:.1} ms",
                stats.loss_percent,
                stats.avg_rtt.unwrap_or(0.0)
            ));
        } else {
            // ICMP dropped: Mark as warn instead of fatal fail (security groups frequently drop ICMP)
            step_icmp.status = "warn".to_string();
            step_icmp.summary = Some("ICMP 100% 丢包（可能是云安全组/防火墙禁 Ping，继续测试 TCP）".to_string());
        }
    }
    let _ = app.emit(&step_channel, &step_icmp);
    run.steps.push(step_icmp);

    // -----------------------------------------------------------------
    // Step 4: L4 TCP Handshake
    // -----------------------------------------------------------------
    let start_tcp = Utc::now().timestamp_millis();
    let mut step_tcp = StepResult {
        layer: Layer::Tcp.as_str().to_string(),
        name: format!("L4 TCP 端口握手 ({})", target_port),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_tcp);

    if first_failed_layer == Some(Layer::Dns) || first_failed_layer == Some(Layer::Route) {
        step_tcp.status = "skipped".to_string();
        step_tcp.summary = Some("前序步骤失败，跳过 TCP".to_string());
    } else {
        let tcp_cmd = format!(
            "nc -zv -w 3 {0} {1} 2>&1 || (timeout 3 bash -c '</dev/tcp/{0}/{1}') 2>&1",
            resolved_ip, target_port
        );
        let tcp_res = ssh_execute_command_with_timeout(&server_id, &tcp_cmd, 6).await;
        let dur = (Utc::now().timestamp_millis() - start_tcp).max(1) as u64;
        step_tcp.duration_ms = Some(dur);
        step_tcp.detail = Some(tcp_res.stdout.clone());

        let lower = format!("{} {}", tcp_res.stdout.to_lowercase(), tcp_res.stderr.to_lowercase());
        let is_open = tcp_res.exit_code == 0
            || lower.contains("open")
            || lower.contains("succeeded")
            || lower.contains("connected");
        let is_refused = lower.contains("refused");
        let is_timeout = lower.contains("timed out") || lower.contains("timeout");

        if is_open && !is_refused {
            step_tcp.status = "ok".to_string();
            step_tcp.summary = Some(format!("TCP 端口 {} 握手成功 ({} ms)", target_port, dur));
        } else {
            step_tcp.status = "fail".to_string();
            if is_refused {
                step_tcp.summary = Some(format!("端口 {} 连接被拒绝 (Connection Refused)", target_port));
                if first_failed_layer.is_none() {
                    first_failed_layer = Some(Layer::Tcp);
                    verdict_causes.push(format!("对端主机未在端口 {} 上启动监听服务", target_port));
                    verdict_causes.push("服务仅监听了 127.0.0.1 本地回环地址，未对外部 IP 开放".to_string());
                    verdict_actions.push("在对端主机检查 `ss -tulpn | grep {}` 确认监听状态".to_string());
                    verdict_actions.push("确认目标服务配置文件中的 bind 地址是否为 0.0.0.0".to_string());
                }
            } else if is_timeout {
                step_tcp.summary = Some(format!("端口 {} 连接超时 (Connection Timed Out)", target_port));
                if first_failed_layer.is_none() {
                    first_failed_layer = Some(Layer::Tcp);
                    verdict_causes.push("网络路径中间防火墙或云厂商安全组丢弃了 SYN 报文".to_string());
                    verdict_causes.push(format!("对端防火墙（iptables/nftables）未放行端口 {}", target_port));
                    verdict_actions.push(format!("检查安全组入方向规则是否放行 TCP 端口 {}", target_port));
                    verdict_actions.push("在目标服务器检查 `iptables -L -n` 防火墙规则".to_string());
                }
            } else {
                step_tcp.summary = Some(format!("端口 {} 握手失败", target_port));
                if first_failed_layer.is_none() {
                    first_failed_layer = Some(Layer::Tcp);
                    verdict_causes.push(format!("TCP 端口 {} 连通失败", target_port));
                    verdict_actions.push("检查网络链路与端口防火墙放行规则".to_string());
                }
            }
        }
    }
    let _ = app.emit(&step_channel, &step_tcp);
    run.steps.push(step_tcp);

    // -----------------------------------------------------------------
    // Step 5: L5 TLS Certificate Check (for HTTPS or 443)
    // -----------------------------------------------------------------
    let is_tls = proto == "https" || target_port == 443;
    let mut step_tls = StepResult {
        layer: Layer::Tls.as_str().to_string(),
        name: "L5 TLS / SSL 证书握手".to_string(),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_tls);

    if !is_tls {
        step_tls.status = "skipped".to_string();
        step_tls.summary = Some("非 HTTPS / TLS 协议，跳过证书检查".to_string());
    } else if first_failed_layer.is_some() {
        step_tls.status = "skipped".to_string();
        step_tls.summary = Some("前序 TCP 握手失败，跳过 TLS".to_string());
    } else {
        let start_tls = Utc::now().timestamp_millis();
        let tls_cmd = format!(
            "echo | timeout 5 openssl s_client -connect {0}:{1} -servername {2} 2>&1",
            resolved_ip, target_port, target
        );
        let tls_res = ssh_execute_command_with_timeout(&server_id, &tls_cmd, 8).await;
        let dur = (Utc::now().timestamp_millis() - start_tls).max(1) as u64;
        step_tls.duration_ms = Some(dur);
        step_tls.detail = Some(tls_res.stdout.clone());

        let out = &tls_res.stdout;
        let has_cert = out.contains("BEGIN CERTIFICATE") || out.contains("Certificate chain");
        let has_verify_ok = out.contains("Verify return code: 0 (ok)");

        if has_cert {
            if has_verify_ok {
                step_tls.status = "ok".to_string();
                step_tls.summary = Some("TLS 握手成功，证书签名有效且信任链完整".to_string());
            } else {
                step_tls.status = "warn".to_string();
                step_tls.summary = Some("TLS 握手成功，但证书可能自签或域名不匹配（Verify return code 非 0）".to_string());
            }
        } else {
            step_tls.status = "fail".to_string();
            step_tls.summary = Some("TLS 握手失败: 对端未提供有效证书或不支持 TLS 握手".to_string());
            if first_failed_layer.is_none() {
                first_failed_layer = Some(Layer::Tls);
                verdict_causes.push("服务端配置了 HTTP 而非 HTTPS 监听，或 SSL 证书配置错误".to_string());
                verdict_causes.push("TLS 协议版本不匹配或加密套件不兼容".to_string());
                verdict_actions.push("检查 Web 服务器（Nginx/Apache）中的 SSL 证书文件与密钥配置".to_string());
            }
        }
    }
    let _ = app.emit(&step_channel, &step_tls);
    run.steps.push(step_tls);

    // -----------------------------------------------------------------
    // Step 6: L6 HTTP Application Check
    // -----------------------------------------------------------------
    let mut step_http = StepResult {
        layer: Layer::Http.as_str().to_string(),
        name: "L6 HTTP 应用层请求".to_string(),
        status: "running".to_string(),
        duration_ms: None,
        summary: None,
        detail: None,
        error: None,
    };
    let _ = app.emit(&step_channel, &step_http);

    if first_failed_layer.is_some() {
        step_http.status = "skipped".to_string();
        step_http.summary = Some("底层网络或握手失败，跳过 HTTP 检查".to_string());
    } else {
        let start_http = Utc::now().timestamp_millis();
        let scheme = if is_tls { "https" } else { "http" };
        let url = if (is_tls && target_port == 443) || (!is_tls && target_port == 80) {
            format!("{}://{}", scheme, target)
        } else {
            format!("{}://{}:{}", scheme, target, target_port)
        };

        let curl_cmd = format!(
            "curl -sS -k -o /dev/null -w '%{{http_code}}\\n%{{time_namelookup}}\\n%{{time_connect}}\\n%{{time_appconnect}}\\n%{{time_starttransfer}}\\n%{{time_total}}\\n%{{remote_ip}}\\n' -L -m 10 \"{}\" 2>&1",
            url
        );
        let curl_res = ssh_execute_command_with_timeout(&server_id, &curl_cmd, 12).await;
        let dur = (Utc::now().timestamp_millis() - start_http).max(1) as u64;
        step_http.duration_ms = Some(dur);
        step_http.detail = Some(curl_res.stdout.clone());

        if let Some(timing) = parse_curl_timing(&curl_res.stdout) {
            if timing.http_code >= 200 && timing.http_code < 400 {
                step_http.status = "ok".to_string();
                step_http.summary = Some(format!(
                    "状态码 {} | 总耗时 {:.0}ms (DNS: {:.0}ms, TCP: {:.0}ms, 首字节: {:.0}ms)",
                    timing.http_code, timing.time_total_ms, timing.time_namelookup_ms, timing.time_connect_ms, timing.time_starttransfer_ms
                ));
            } else if timing.http_code >= 400 && timing.http_code < 500 {
                step_http.status = "warn".to_string();
                step_http.summary = Some(format!("HTTP 客户端错误 (状态码 {})", timing.http_code));
            } else if timing.http_code >= 500 {
                step_http.status = "fail".to_string();
                step_http.summary = Some(format!("HTTP 服务端异常 (状态码 {})", timing.http_code));
                if first_failed_layer.is_none() {
                    first_failed_layer = Some(Layer::Http);
                    verdict_causes.push(format!("上游服务返回 HTTP {} 错误（内部服务器错误/网关超时等）", timing.http_code));
                    verdict_actions.push("检查应用服务器日志或反向代理（如 Nginx/Envoy）错误日志".to_string());
                }
            } else {
                step_http.status = "fail".to_string();
                step_http.summary = Some("HTTP 请求未收到有效状态码响应".to_string());
            }
        } else {
            step_http.status = "fail".to_string();
            step_http.summary = Some("curl 请求执行失败".to_string());
            step_http.error = Some(curl_res.stderr.clone());
        }
    }
    let _ = app.emit(&step_channel, &step_http);
    run.steps.push(step_http);

    // -----------------------------------------------------------------
    // Finish Run & Generate Verdict
    // -----------------------------------------------------------------
    run.finished_at = Some(Utc::now().timestamp_millis());

    let has_fail = run.steps.iter().any(|s| s.status == "fail");
    let has_warn = run.steps.iter().any(|s| s.status == "warn");
    run.status = if has_fail {
        "fail".to_string()
    } else if has_warn {
        "warn".to_string()
    } else {
        "ok".to_string()
    };

    let verdict = if let Some(ref failed) = first_failed_layer {
        Verdict {
            failed_layer: Some(failed.as_str().to_string()),
            summary: format!("诊断定位：网络在 [{}] 发生中断", failed.as_str().to_uppercase()),
            causes: verdict_causes,
            next_actions: verdict_actions,
        }
    } else if has_warn {
        Verdict {
            failed_layer: None,
            summary: "核心服务端口与 HTTP 连通正常，但存在部分警告指标（如 ICMP 丢包或非 2xx 状态码）".to_string(),
            causes: vec!["安全组屏蔽了非业务协议或端点返回重定向/客户端提示".to_string()],
            next_actions: vec!["业务连通性不受影响，可继续观察".to_string()],
        }
    } else {
        Verdict {
            failed_layer: None,
            summary: "网络链路全层通过，DNS 解析、出站路由、TCP 握手与 HTTP 请求均处于健康状态".to_string(),
            causes: Vec::new(),
            next_actions: vec!["网络环境良好，无需排查".to_string()],
        }
    };

    run.verdict = Some(verdict);

    // Save to SQLite
    let _ = super::store::save_run(&run);

    let _ = app.emit(&done_channel, &run);
    Ok(run)
}

// ==================== Traceroute & Ping ====================

pub async fn run_traceroute(
    server_id: &str,
    target: &str,
    mode: Option<&str>,
) -> Result<String, String> {
    validate_target(target)?;
    let mode_flag = match mode {
        Some("tcp") => "-T",
        Some("udp") => "-U",
        _ => "-I",
    };

    let cmd = format!(
        "traceroute -n -w 2 -q 1 -m 30 {} {} 2>&1 || tracepath -n {} 2>&1",
        mode_flag, target, target
    );
    let res = ssh_execute_command_with_timeout(server_id, &cmd, 45).await;
    Ok(res.stdout)
}

pub async fn run_ping(
    server_id: &str,
    target: &str,
    count: Option<u32>,
) -> Result<String, String> {
    validate_target(target)?;
    let c = count.unwrap_or(4).min(20);
    let cmd = format!("ping -c {} -W 2 {} 2>&1", c, target);
    let res = ssh_execute_command_with_timeout(server_id, &cmd, 15).await;
    Ok(res.stdout)
}

// ==================== Packet Capture (tcpdump) ====================

pub async fn start_capture(
    server_id: &str,
    req: CaptureReq,
) -> Result<CaptureResult, String> {
    validate_iface(&req.iface)?;
    if let Some(ref f) = req.filter {
        validate_filter(f)?;
    }

    let max_packets = req.max_packets.unwrap_or(500).min(5000);
    let duration_secs = req.duration_secs.unwrap_or(15).min(60);
    let timestamp = Utc::now().timestamp_millis();
    let remote_path = format!("/tmp/capture_{}_{}.pcap", req.iface, timestamp);

    let filter_str = req.filter.unwrap_or_default();
    let cmd = format!(
        "timeout {0} tcpdump -i {1} -c {2} -w {3} -s 0 {4} 2>&1",
        duration_secs + 2,
        req.iface,
        max_packets,
        remote_path,
        filter_str
    );

    let res = ssh_execute_command_with_timeout(server_id, &cmd, (duration_secs + 5) as u64).await;

    // Check captured file stats
    let stat_cmd = format!("stat -c %s {} 2>/dev/null || wc -c < {} 2>/dev/null", remote_path, remote_path);
    let stat_res = ssh_execute_command_with_timeout(server_id, &stat_cmd, 5).await;
    let file_size_bytes = stat_res.stdout.trim().parse::<u64>().unwrap_or(0);

    // Read base64 content if under 5MB for direct local download
    let mut pcap_base64 = None;
    if file_size_bytes > 0 && file_size_bytes <= 5 * 1024 * 1024 {
        let b64_cmd = format!("base64 -w 0 {} 2>/dev/null || base64 {} 2>/dev/null", remote_path, remote_path);
        let b64_res = ssh_execute_command_with_timeout(server_id, &b64_cmd, 15).await;
        let clean = b64_res.stdout.replace(['\n', '\r'], "");
        if !clean.is_empty() {
            pcap_base64 = Some(clean);
        }
    }

    let success = file_size_bytes > 0;
    Ok(CaptureResult {
        success,
        packet_count: max_packets,
        file_size_bytes,
        remote_path,
        pcap_base64,
        error: if success { None } else { Some(res.stdout + "\n" + &res.stderr) },
    })
}
