use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceInfo {
    pub name: String,
    #[serde(default)]
    pub index: Option<u32>,
    #[serde(default)]
    pub mac: String,
    #[serde(default)]
    pub flags: Vec<String>,
    #[serde(default)]
    pub mtu: u32,
    pub state: String, // "UP", "DOWN", "UNKNOWN"
    #[serde(default)]
    pub operstate: String,
    #[serde(default)]
    pub ipv4: Vec<String>,
    #[serde(default)]
    pub ipv6: Vec<String>,
    #[serde(default)]
    pub rx_bytes: u64,
    #[serde(default)]
    pub tx_bytes: u64,
    #[serde(default)]
    pub rx_packets: u64,
    #[serde(default)]
    pub tx_packets: u64,
    #[serde(default)]
    pub rx_errors: u64,
    #[serde(default)]
    pub tx_errors: u64,
    #[serde(default)]
    pub rx_dropped: u64,
    #[serde(default)]
    pub tx_dropped: u64,
    #[serde(default)]
    pub speed: Option<String>,
    #[serde(default)]
    pub duplex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EthtoolInfo {
    pub iface: String,
    pub speed: Option<String>,
    pub duplex: Option<String>,
    pub port: Option<String>,
    pub auto_negotiation: Option<String>,
    pub link_detected: Option<bool>,
    pub driver: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouteInfo {
    pub destination: String,
    pub gateway: Option<String>,
    pub genmask: Option<String>,
    pub iface: String,
    pub metric: Option<i32>,
    pub scope: Option<String>,
    pub protocol: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouteView {
    pub routes: Vec<RouteInfo>,
    pub default_gateway: Option<String>,
    pub default_iface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouteGetResult {
    pub destination: String,
    pub gateway: Option<String>,
    pub iface: String,
    pub src_ip: Option<String>,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DnsConfigInfo {
    pub nameservers: Vec<String>,
    pub search_domains: Vec<String>,
    pub options: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SocketInfo {
    pub protocol: String, // tcp, udp, tcp6, udp6
    pub local_address: String,
    pub local_port: u16,
    pub foreign_address: String,
    pub foreign_port: u16,
    pub state: String, // LISTEN, ESTAB, TIME-WAIT, etc.
    pub pid: Option<i64>,
    pub process_name: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnQuery {
    pub filter: Option<String>,
    pub state: Option<String>,
    pub protocol: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnPage {
    pub items: Vec<SocketInfo>,
    pub total: usize,
    pub listening_count: usize,
    pub established_count: usize,
    pub other_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NeighborInfo {
    pub ip: String,
    pub mac: Option<String>,
    pub iface: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostCapabilities {
    pub has_iproute2: bool,
    pub ip_json: bool,
    pub has_ss: bool,
    pub has_conntrack: bool,
    pub has_tcpdump: bool,
    pub has_mtr: bool,
    pub has_traceroute: bool,
    pub has_ethtool: bool,
    pub has_curl: bool,
    pub can_icmp: bool,
    pub can_capture: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetOverview {
    pub interfaces: Vec<InterfaceInfo>,
    pub default_gateway: Option<String>,
    pub default_iface: Option<String>,
    pub dns_servers: Vec<String>,
    pub listening_ports_count: usize,
    pub established_conn_count: usize,
    pub capabilities: HostCapabilities,
    pub recent_runs: Vec<NetworkRunSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Layer {
    Dns,
    Route,
    L3,
    Tcp,
    Tls,
    Http,
}

impl Layer {
    pub fn as_str(&self) -> &'static str {
        match self {
            Layer::Dns => "dns",
            Layer::Route => "route",
            Layer::L3 => "l3",
            Layer::Tcp => "tcp",
            Layer::Tls => "tls",
            Layer::Http => "http",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub layer: String, // "dns", "route", "l3", "tcp", "tls", "http"
    pub name: String,
    pub status: String, // "ok", "warn", "fail", "skipped", "running", "pending"
    pub duration_ms: Option<u64>,
    pub summary: Option<String>,
    pub detail: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub failed_layer: Option<String>,
    pub summary: String,
    pub causes: Vec<String>,
    pub next_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub target: String,
    pub port: Option<u16>,
    pub protocol: String, // "http", "https", "tcp"
    pub timeout_ms: u32,
}

impl RunSpec {
    pub fn fingerprint(&self) -> String {
        format!(
            "{}:{}:{}",
            self.target.trim().to_lowercase(),
            self.port.unwrap_or(0),
            self.protocol.trim().to_lowercase()
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRun {
    pub id: String,
    pub server_id: String,
    pub spec: RunSpec,
    pub spec_fingerprint: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: String, // "ok", "warn", "fail", "running"
    pub steps: Vec<StepResult>,
    pub verdict: Option<Verdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRunSummary {
    pub id: String,
    pub server_id: String,
    pub target: String,
    pub port: Option<u16>,
    pub status: String,
    pub failed_layer: Option<String>,
    pub started_at: i64,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunDiff {
    pub run_a: NetworkRun,
    pub run_b: NetworkRun,
    pub dns_diff: Option<String>,
    pub route_diff: Option<String>,
    pub latency_diff_ms: Option<i64>,
    pub status_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReq {
    pub iface: String,
    pub filter: Option<String>,
    pub max_packets: Option<u32>,
    pub duration_secs: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub success: bool,
    pub packet_count: u32,
    pub file_size_bytes: u64,
    pub remote_path: String,
    pub pcap_base64: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub format: String,
    pub content: String,
    pub filename: String,
}
