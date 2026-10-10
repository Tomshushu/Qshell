# Qshell · 网络模块 技术设计文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-09-09 |
| 技术栈 | Tauri 2 + React 18 + TypeScript + Rust 2021 |
| 关联文档 | 《Qshell_网络模块_需求文档.md》 |
| 设计主线 | 统一领域模型 + 双执行点（本地原生 / SSH 会话）+ 能力探测驱动的降级 |
| 范围约束 | **不引入远端 agent**，所有服务器侧事实通过已建立的 SSH 会话获取 |

---

## 1. 总体架构

### 1.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ React UI (TypeScript)                                        │
│  概览 / 接口 / 连接 / 路由DNS / 诊断 / 抓包 / 历史            │
│  状态: TanStack Query (服务端态) + Zustand (UI 态)            │
│  图表: uPlot(高频时序) + ECharts(统计)  表格: TanStack Table  │
└─────────────── Tauri IPC: commands + events ─────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ Rust Core (Tauri App)                                        │
│  ┌────────────┐ ┌─────────────┐ ┌──────────┐ ┌────────────┐ │
│  │ net-domain │ │net-registry │ │ net-exec │ │ net-parse  │ │
│  │ 领域模型    │ │ 能力/命令表  │ │ 执行引擎  │ │ 输出适配器 │ │
│  └────────────┘ └─────────────┘ └──────────┘ └────────────┘ │
│  ┌────────────┐ ┌─────────────┐ ┌──────────────────────────┐ │
│  │ net-probe  │ │  net-store  │ │ 现有 session manager      │ │
│  │ 原生探测   │ │ SQLite 留痕 │ │ (SSH/SFTP 会话复用)       │ │
│  └────────────┘ └─────────────┘ └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
        │                    │
   本地原生 socket      SSH exec channel
   (socket2/reqwest)    (主路径: 服务器事实)
```

### 1.2 Crate / 模块划分

在现有 workspace 中新增（不改动既有 SSH/SFTP 模块，只依赖它）：

```
crates/
  net-domain/     领域模型、错误类型、权限枚举（无 IO）
  net-registry/   能力规格表 CapabilitySpec + CmdVariant 定义
  net-parse/      输出适配器（JSON / 文本 / 二进制），纯函数，易测
  net-exec/       执行引擎：能力探测、变体选择、超时、取消、限额、审计
  net-probe/      本地原生探测（socket2 / reqwest / hickory-dns）
  net-store/      SQLite：runs / evidence / snapshots / reports
  net-tauri/      #[tauri::command] 与事件封装，供前端调用
```

**为什么把 `net-parse` 独立**：它是纯函数模块（输入 `&str`/`&[u8]`，输出领域结构），可以用 golden-file 做海量回归测试，不依赖 SSH、不依赖真实主机。这是整个模块质量的地基。

### 1.3 核心依赖选型

| 用途 | 选型 | 理由 |
|---|---|---|
| SSH | 复用现有实现；若尚未定型，优先 `russh`（纯 Rust，跨平台编译友好），`ssh2` 需链接 libssh2 | 需支持 exec channel + 复用已登录会话 |
| DNS | `hickory-dns`（原 trust-dns）的 `resolver` / `proto` | 可指定解析器、控制 EDNS/DNSSEC、结构化错误，替代解析 `dig` 文本 |
| TCP 探测 | `socket2` | 精细控制超时、bind 源地址、SO_MARK |
| HTTP(S) | `reqwest`（rustls 或 native-tls） | 稳定、支持代理与 HTTP/2；配合手动计时取分阶段耗时 |
| 系统信息（本机） | `sysinfo` | 桌面端本机接口累计量、进程信息 |
| IP/CIDR | `ipnet` | 范围校验、ACL 判断 |
| 异步 | 现有 `tokio` | — |
| 序列化 | `serde` + `serde_json` | Tauri IPC 传递 |
| 本地存储 | `rusqlite`（建议 bundled） | run 留痕与快照 |
| 抓包/扫描 | **不进主二进制**，走远端命令或 Tauri sidecar（`externalBin`） | 需 `CAP_NET_RAW` / root，避免桌面端提权 |
| eBPF（`aya` 等） | **不使用** | 需要远端常驻组件，本项目明确不做 agent；等效信息改用 `/proc`、`ss`、短时抓包采样获取 |

> 关于 trippy：它自 0.11 起提供公共 crate（`trippy-core` 等），可用于构建自定义 traceroute，但官方明确 API 尚未稳定。建议**锁定版本 + feature flag + 版本兼容测试**后再引入；短期优先用系统 `traceroute` / `mtr`。

---

## 2. 执行模型

### 2.1 两个执行点

| 执行点 | 适用 | 约束 | 定位 |
|---|---|---|---|
| `Local`（Rust 后端本机） | 桌面端本机网络、从本机发起的 TCP/HTTP/DNS 探测 | ICMP/抓包受平台特权限制 | 补充视角：从外部看目标 |
| `Ssh`（已有会话） | 服务器接口/路由/连接/抓包/扫描/探测 | 依赖远端工具、需白名单与资源控制 | **主路径**：主机内部事实 |

**明确不做远端 agent。** 所有服务器侧信息一律通过已建立的 SSH 会话执行系统命令获取，不在目标机部署任何常驻进程、不引入 eBPF。由此产生的能力取舍：

| 原本依赖 agent 的能力 | 无 agent 的替代方案 |
|---|---|
| eBPF 级 per-process 流量 | 短时采样 `bandwhich -r` / `nethogs -t`（远端按需执行）；或 `/proc/<pid>/net` + `ss -p` 关联 |
| 内核级重传/延迟追踪 | `ss -i`（rtt、retrans）+ `/proc/net/netstat` 计数器差分 |
| 长周期基线与常驻告警 | 由桌面端按需轮询 + SQLite 留痕；不做 7×24 常驻采集 |
| 高采样率流量 | 受限：`flow.top` 默认 10s 短采样，不长期驻留 |

### 2.2 能力探测（Capability Probe）

连接建立后异步探测一次，结果缓存到资产（TTL 建议 24h，或用户手动刷新）。

```rust
pub enum Capability {
    Available,               // 可用
    AvailableWithElevation,  // 存在但需提权（sudo / CAP_NET_RAW）
    NotInstalled,            // 二进制缺失
    Unsupported,             // 存在但版本/编译选项不支持所需输出格式
}

pub struct HostCapabilities {
    pub has_iproute2: bool,
    pub ip_json: bool,             // ip 是否支持 -json
    pub has_ss: bool,
    pub ss_no_header: bool,        // ss -H 支持
    pub has_conntrack: bool,
    pub has_tcpdump: bool,
    pub has_mtr: bool,
    pub mtr_json: bool,            // mtr --json 需按版本探测
    pub has_traceroute: bool,
    pub has_ethtool: bool,
    pub has_curl: bool,
    pub has_iperf3: bool,
    pub has_nmap: bool,
    pub can_icmp: Capability,      // CAP_NET_RAW / ping_group_range
    pub can_capture: Capability,
    pub sudo_policy: SudoPolicy,
}
```

探测命令示例（`command -v <bin>` + 版本探测 + `sudo -n true` 退出码 + `capsh --print`/读 `/proc/self/status` 的 CapEff）。**禁止用"命令是否启动成功"判断权限是否完整** —— 权限不足时命令常返回部分结果而非失败。

### 2.3 变体选择与执行流程

```
请求 Capability(id, params)
  → 读 HostCapabilities
  → 按 priority 过滤可用 variants（依赖二进制存在 + 输出格式支持 + 权限匹配）
  → 选第一个可行 variant；无可行则返回 Err(Unsupported{ reason, install_hint })
  → build(params) 构造 Cmd（类型化，非字符串拼接）
  → 安全检查：二进制白名单 + 参数校验 + 目标归属校验
  → 执行（超时 / 取消令牌 / 输出字节上限 / 并发限流）
  → parse(输出) → Evidence
  → 落库 + 审计
```

### 2.4 执行约束（硬性）

| 约束 | 值 | 说明 |
|---|---|---|
| 单次 exec 输出上限 | 8 MB | 超限截断并标记 `truncated` |
| 单主机并发 exec | ≤ 4 | 避免打满 SSH 通道影响交互终端 |
| 默认超时 | 读命令 5s / 探测 10s / 抓包按用户设定 | 可变，见注册表 |
| 抓包产物上限 | 100 MB 或 用户设定，取小 | 达上限自动停止 |
| 采样节流 | ≥ 1s | 实时面板 |
| 取消 | 所有长任务支持 `CancellationToken` | 前端可随时中止 |

---

## 3. 命令注册表（net-registry）

### 3.1 规格定义

```rust
pub struct CapabilitySpec {
    pub id: &'static str,              // "link.list"
    pub title: &'static str,
    pub layer: Layer,                  // Read | Probe | Capture
    pub min_privilege: Privilege,      // None | CapNetRaw | Root
    pub exec: ExecTargetKind,          // Ssh | Local | Both
    pub variants: Vec<CmdVariant>,
}

pub struct CmdVariant {
    pub id: &'static str,
    pub needs: &'static [Binary],      // 依赖的远端二进制
    pub probe: Option<&'static str>,   // 格式支持探测，如 "ip -j -s link"
    pub build: fn(&Params) -> Result<Cmd>,   // 类型化构造
    pub output: OutputFormat,          // Json | Text(ParserId) | Binary(Mime)
    pub priority: u8,                  // 数字小优先
}

pub struct Cmd {
    pub program: String,
    pub args: Vec<String>,
    pub sudo: bool,
    pub timeout: Duration,
    pub max_bytes: usize,
}
```

> 关键约束：`build` 只做参数构造，禁止拼 shell 字符串；所有用户输入必须过校验器（见 §6）。

### 3.2 注册表（首版）

#### A. 配置事实（Layer: Read）

| Capability | 优先变体 | 降级变体 | 输出解析 | 权限 |
|---|---|---|---|---|
| `link.list` | `ip -j -s link` | `ip -s link` → `cat /proc/net/dev` + `ls /sys/class/net` | JSON / 文本 | 查看通常无需特权 |
| `addr.list` | `ip -j addr` | `ip addr` / `ifconfig -a` | JSON / 文本 | 无 |
| `route.list` | `ip -j route` + `ip -j rule` | `ip route` / `netstat -rn` | JSON / 文本 | 无 |
| `route.get` | `ip -j route get <target>` | `ip route get <target>` | JSON / 文本 | 无 |
| `neigh.list` | `ip -j neigh` | `arp -n` / `ip neigh` | JSON / 文本 | 无 |
| `dns.config` | `resolvectl status` | `cat /etc/resolv.conf` + `nmcli dev show` | 文本解析器 | 无 |
| `link.ethtool` | `ethtool <iface>`（`Speed`/`Duplex`/`Link detected`） | `cat /sys/class/net/<if>/speed` | 文本 | 通常需 `CAP_NET_ADMIN` |
| `bridge.list` | `ip -j link show type bridge` + `bridge -j fdb` | — | JSON | 无（查看） |
| `netns.list` | `ip -j netns list` | `lsns -t net` | JSON / 文本 | 查看通常无 |
| `fw.summary` | `nft -j list ruleset` | `iptables -L -n -v -x` / `firewall-cmd --list-all` | JSON / 文本 | 通常需 root |

#### B. 连接与服务（Layer: Read）

| Capability | 优先变体 | 降级变体 | 解析要点 | 权限 |
|---|---|---|---|---|
| `sock.listen` | `ss -tulpnH` | `ss -tulpn`（跳过首行）→ `netstat -tulpn` | 解析 Recv-Q/Send-Q/Local/Peer/Process | `-p` 需权限，缺失则进程列为空 |
| `sock.all` | `ss -tulpnHa`（按状态过滤） | 同上 | 需虚拟滚动，可能上万行 | 同上 |
| `sock.summary` | `ss -s` | `cat /proc/net/sockstat` | 文本 | 无 |
| `conntrack.usage` | 读 `nf_conntrack_count` / `nf_conntrack_max` | `conntrack -L --output json`（需工具） | JSON / 数值 | 计数文件通常可读 |
| `proc.port` | 由 `sock.listen` 结果本地过滤 | 无特权时：`/proc/net/{tcp,udp}` + `/proc/*/fd` inode 反查 PID | inode→PID 映射 | 无特权路径较慢，需缓存 |

#### C. 探测（Layer: Probe）

| Capability | 执行点 | 变体 | 输出 | 权限 |
|---|---|---|---|---|
| `dns.query` | **Local（Rust hickory）** | 指定解析器/记录类型/DoT/DoH | 结构化 | 无 |
| `dns.query.remote` | Ssh | `dig +noall +answer +stats <name> <type> @<ns>`；或 `dog --json`（若安装） | 文本（dig 的 JSON 支持随版本而异，走文本解析） | 无 |
| `icmp.ping` | Ssh | `ping -c N -W T -i I <host>`（Linux）；`ping -c N` (BSD) | 解析 `rtt min/avg/max/mdev` 与 `packet loss` | 通常需 `CAP_NET_RAW` 或 `ping_group_range` |
| `tcp.connect` | Local（socket2）/ Ssh 可选 | 纯 Rust connect，区分 `refused`/`timeout`/`unreachable` | 结构化 | 无 |
| `http.check` | Local（reqwest） | 分阶段计时 + 证书 + 重定向链 | 结构化 | 无 |
| `http.check.remote` | Ssh | `curl -sS -o /dev/null -w '<fmt>' ...`（`time_namelookup/connect/appconnect/starttransfer/total/http_code/remote_ip/num_redirects/ssl_verify_result`） | 文本 | 无 |
| `tls.inspect` | Local（rustls 握手取证书链） | 远端 `openssl s_client -connect h:p -servername h` | 结构化 / 文本 | 无 |
| `trace.route` | Ssh | `traceroute -n -w 2 -q 1 -m 30 <host>`；TCP 模式加 `-T -p <port>` | 文本 | 通常需 `CAP_NET_RAW` |
| `trace.mtr` | Ssh | `mtr -n -r -c N <host>`（报告模式，最稳）；`--json` 仅当 `mtr_json` 探测通过 | 文本 / JSON | 同上 |
| `mtu.probe` | Ssh | `ping -M do -s <size>` 递减 | 文本 | 需 ICMP |

#### D. 性能与流量（Layer: Read/Probe）

| Capability | 变体 | 说明 |
|---|---|---|
| `iface.rate` | 两次 `/proc/net/dev` 或 `ip -j -s link` 差分 | 采样间隔 1s/5s，前端折线图；**不要**每次重新拉全量 |
| `iface.errors` | 同上的 errors/drops/frame/fifo/carrier 字段 | 标注突增 |
| `flow.top` | 短采样 `bandwhich -r` 或 `nethogs -t -d N`（远端） | 需抓包权限，默认 10s 采样后自动结束；缺失则降级为「按连接 + 进程」估算 |
| `throughput` | `iperf3 -c <host> -J`（JSON 稳定） | 需对端服务端；`-s` 模式需用户显式启动并注意端口开放 |

#### E. 取证（Layer: Capture，风险最高）

| Capability | 变体 | 约束 |
|---|---|---|
| `pcap.capture` | `tcpdump -i <if> -s 0 -c N -w <tmpfile> <filter>` → SFTP 拉回 | 需 `CAP_NET_RAW`；产物上限；自动清理远端临时文件（finally） |
| `port.scan` | `rustscan -a <target> -- -A`（或 `nmap -oX -`） | 必须前置范围确认 + 授权声明 + 速率上限 + 结果快照 |

### 3.3 输出解析原则

1. **优先机读格式**：`ip -j`、`iperf3 -J`、`nft -j`、`reqwest`/`hickory` 结构化返回。
2. **文本解析必须带版本容错**：同一命令不同版本字段顺序/命名不同，解析器用"按 key 匹配 + 宽松正则"，不依赖固定列号。
3. **异常样本一等公民**：空输出、`Permission denied`、`command not found`、超时、被截断，都要映射成明确错误类型，而不是 `ParseError`。
4. 每个解析器配套 golden-file 测试（正常 / 老版本 / 权限不足 / 空输出 / 超长输出）。

---

## 4. 数据模型

### 4.1 Rust 领域模型（net-domain）

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct RunSpec {
    pub target: String,                 // host 或 IP
    pub port: Option<u16>,
    pub protocol: Protocol,             // Icmp | Tcp | Udp | Http | Https | Dns
    pub exec_point: ExecPoint,          // Local | Ssh(asset_id)
    pub source_iface: Option<String>,
    pub count: Option<u32>,
    pub timeout_ms: u32,
    pub extra: BTreeMap<String, Value>, // 其余参数（有序，保证 spec hash 稳定）
}

impl RunSpec {
    pub fn fingerprint(&self) -> String { /* 规范化后 blake3，作为历史对比主键 */ }
}

pub struct NetworkRun {
    pub id: RunId,
    pub asset_id: AssetId,
    pub spec: RunSpec,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: RunStatus,              // Running | Ok | Degraded | Failed | Cancelled
    pub steps: Vec<StepResult>,
    pub evidence: Vec<Evidence>,
    pub privilege: PrivilegeContext,    // 执行时实际权限快照
    pub tool_versions: Vec<ToolVersion>,
}

pub enum Evidence {
    Metrics(Vec<MetricPoint>),
    Table(DataTable),                   // 列定义 + 行，供 CSV 导出
    Text { label: String, body: String },
    Chart(ChartSeries),
    File { name: String, mime: String, path: PathBuf }, // pcap 等
    Verdict(Verdict),
}

pub struct Verdict {
    pub failed_layer: Option<Layer>,    // Dns | Route | L3 | Tcp | Tls | Http
    pub summary: String,
    pub causes: Vec<String>,
    pub next_actions: Vec<String>,
}
```

### 4.2 前端类型（由 Rust 生成或手写同步）

```ts
export type Layer = 'dns' | 'route' | 'l3' | 'tcp' | 'tls' | 'http';
export interface StepResult {
  layer: Layer; name: string; status: 'pending'|'running'|'ok'|'warn'|'fail'|'skipped';
  durationMs?: number; summary?: string; evidenceIds: string[]; error?: NetError;
}
export interface NetworkRun {
  id: string; assetId: string; spec: RunSpec; startedAt: string;
  status: 'running'|'ok'|'degraded'|'failed'|'cancelled';
  steps: StepResult[]; evidence: Evidence[]; verdict?: Verdict;
}
```

### 4.3 存储（SQLite）

```sql
CREATE TABLE network_runs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  spec_fingerprint TEXT NOT NULL,   -- 同口径对比用
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  verdict_json TEXT
);
CREATE INDEX idx_runs_asset_time ON network_runs(asset_id, started_at DESC);
CREATE INDEX idx_runs_fp ON network_runs(asset_id, spec_fingerprint);

CREATE TABLE network_evidence (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_json TEXT, file_path TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE network_snapshots (          -- A7 配置快照
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, kind TEXT NOT NULL,
  payload_json TEXT NOT NULL, taken_at INTEGER NOT NULL
);
CREATE TABLE network_reports (            -- E3 导出留痕
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, format TEXT NOT NULL,
  path TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE net_audit (                  -- §6 审计
  id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL,
  actor TEXT NOT NULL, reason TEXT, capability TEXT NOT NULL,
  argv_hash TEXT NOT NULL, privilege TEXT, started_at INTEGER, finished_at INTEGER,
  outcome TEXT NOT NULL
);
```

---

## 5. Rust 后端设计

### 5.1 Tauri Command 接口

```rust
// 事实类（短、可缓存）
#[tauri::command] async fn net_overview(asset: AssetId) -> Result<NetOverview>;
#[tauri::command] async fn net_interfaces(asset: AssetId) -> Result<Vec<Interface>>;
#[tauri::command] async fn net_connections(asset: AssetId, q: ConnQuery) -> Result<ConnPage>;
#[tauri::command] async fn net_routes(asset: AssetId) -> Result<RouteView>;
#[tauri::command] async fn net_dns_config(asset: AssetId) -> Result<DnsConfig>;
#[tauri::command] async fn net_capabilities(asset: AssetId, refresh: bool) -> Result<HostCapabilities>;

// 运行类（长、流式事件）
#[tauri::command] async fn net_run_start(app: AppHandle, spec: RunSpec) -> Result<RunId>;
#[tauri::command] async fn net_run_cancel(id: RunId) -> Result<()>;
#[tauri::command] async fn net_run_get(id: RunId) -> Result<NetworkRun>;
#[tauri::command] async fn net_runs_list(asset: AssetId, limit: u32) -> Result<Vec<RunSummary>>;
#[tauri::command] async fn net_runs_compare(a: RunId, b: RunId) -> Result<RunDiff>;

// 取证与导出
#[tauri::command] async fn net_capture_start(app: AppHandle, req: CaptureReq) -> Result<RunId>;
#[tauri::command] async fn net_report_export(id: RunId, fmt: ReportFormat) -> Result<ExportResult>;
```

事件通道（前端 `listen`）：

| 事件 | 载荷 | 用途 |
|---|---|---|
| `net://run/{id}/step` | `StepResult` | 流水线逐层点亮 |
| `net://run/{id}/progress` | `{ done, total, message }` | MTR/扫描/抓包进度 |
| `net://run/{id}/done` | `NetworkRun` | 完成 |
| `net://metrics/{asset}` | `IfaceSample[]` | 实时速率（节流后推送） |

### 5.2 SSH 会话复用

- 复用现有 session manager 拿到的已认证会话，**不新建连接**。
- 每个资产一个 `Semaphore(4)` 限并发；`exec` 使用独立的 channel，不占用交互终端的 channel。
- 长任务（抓包/MTR）用独立 channel + 心跳，避免阻塞其他命令。
- 会话断开时：所有在跑的 Run 标记 `Failed{ reason: SessionLost }`，前端统一提示重连。

### 5.3 并发与取消

```rust
pub struct RunHandle { cancel: CancellationToken, task: JoinHandle<()> }
pub struct RunRegistry { inner: DashMap<RunId, RunHandle> }
```

- 每个 Run 独立 `CancellationToken`；取消时先终止读循环，再尽力执行远端清理（如 kill tcpdump、删临时文件）。
- 超时分两级：命令级（`Cmd::timeout`）+ 运行级（整体预算，默认 60s）。

### 5.4 错误模型

```rust
pub enum NetError {
    CapabilityUnavailable { id: String, hint: String },  // 工具缺失，给安装建议
    InsufficientPrivilege { need: Privilege, hint: String },
    Timeout { stage: String },
    Cancelled,
    SessionLost,
    ParseFailed { sample: String },        // 含原始片段便于反馈
    TargetRejected { reason: String },     // 安全校验未通过
    RemoteFailed { exit_code: i32, stderr: String },
    Io(String),
}
```

前端按错误类型渲染不同的可操作提示（缺工具 → 给安装命令；权限不足 → 提权确认；超时 → 调整参数重试）。

---

## 6. 权限与安全

### 6.1 三条铁律

1. **命令白名单**：`Cmd::program` 必须命中注册表常量；任何用户可控字符串只能出现在 `args` 的受校验槽位，永不做 shell 拼接（不经过 `sh -c`）。
2. **参数类型化校验**：

```rust
fn validate_target(s: &str) -> Result<()> {   // 域名 / IPv4 / IPv6
    if s.len() > 253 { bail!(TargetRejected) }
    if is_ip_addr(s) { return Ok(()) }
    // 域名：仅允许 [a-z0-9.-]，标签非空、不以 . 结尾
}
fn validate_iface(s: &str) -> Result<()> {    // 仅 [a-zA-Z0-9._-]，长度 ≤ 15
}
fn validate_tcpdump_filter(s: &str) -> Result<()> {
    // 先做字符黑名单（; | & $ ` \n），再交给远端 `tcpdump -d <filter>` 做语法 dry-run 校验
}
```
3. **目标归属校验**：扫描/抓包目标必须属于当前资产或用户显式确认的范围；跨资产目标需二次确认。

### 6.2 提权策略

```rust
pub enum SudoPolicy { Never, Ask, Always }
```

- `Never`：只跑非特权命令；需要特权的能力在 UI 上显示"需提权"，点击后弹二次确认并临时允许。
- `Ask`：执行前用 `sudo -n true` 探测；失败则弹密码输入框（密码只存于内存，用完清零，绝不落盘/不进日志）。
- `Always`：仅限用户在资产配置中显式开启，且审计记录完整。

**不做的事**：不在桌面端全局提权；不把 root 密码写入配置；不默认启用抓包/扫描。

### 6.3 平台差异

| 平台 | ICMP | 抓包 | 说明 |
|---|---|---|---|
| Linux | 需 `CAP_NET_RAW` 或 `net.ipv4.ping_group_range` | 需 `CAP_NET_RAW`/`CAP_NET_ADMIN` | 服务器场景可用 file capability 精细授权 |
| macOS | 普通用户部分 UDP traceroute 可行；原始 ICMP 通常需提权 | 需管理员 | 桌面端本地诊断能力受限，需 sidecar + 授权 |
| Windows | 依赖系统 API | 需 Npcap | 桌面端本地诊断走系统 API，避免引入 Npcap 依赖 |

远端 Linux 主机的 ICMP/抓包由远端权限决定，与桌面端无关 —— 这是把重型能力下沉到 SSH 的主要收益。

### 6.4 审计

每条命令写入 `net_audit`：`asset_id`、`actor`、`reason`（如 "用户点击一键体检"）、`capability`、`argv_hash`（参数哈希，不存明文敏感值）、`privilege`、时间、结果。报告导出时附带审计摘要。

---

## 7. 前端设计

### 7.1 页面与组件

```
network/
  NetworkLayout.tsx        顶部：资产选择 + 全局搜索（端口/IP 直达）
  OverviewPage.tsx         接口卡片栅格 / 地址路由摘要 / DNS / 监听 TOP / 实时速率 / 最近运行
  InterfacesPage.tsx       接口表 + 错误计数图 + ethtool 详情抽屉
  ConnectionsPage.tsx      监听 + 连接双 Tab，筛选/聚合/进程跳转
  RoutesDnsPage.tsx        路由表 / 策略路由 / 邻居 / 解析器
  DiagnosticsPage.tsx      QuickCheckPanel + AdvancedRunForm + RunTimeline
  CapturePage.tsx          接口/过滤器/上限 + 产物列表
  HistoryPage.tsx          运行列表 + 对比视图 + 导出
components/
  LayerPipeline.tsx        六层流水线可视化（DNS→路由→L3→TCP→TLS→HTTP）
  VerdictCard.tsx          结论卡：失败层、候选原因、下一步动作
  MetricChart.tsx          uPlot 封装，高频时序
  DataTable.tsx            TanStack Table + 虚拟滚动
  EvidenceList.tsx         证据折叠面板（表格/文本/命令/文件）
  PrivilegeBadge.tsx       权限状态与提权入口
  CapabilityHint.tsx       工具缺失时给安装建议
```

### 7.2 状态管理

- **服务端态**：TanStack Query。事实类命令 `staleTime 15~30s`；概览并发拉取，失败单项降级不整体失败。
- **UI 态**：Zustand（当前资产、筛选条件、选中接口、面板折叠）。
- **Run 状态机**：XState 或轻量 reducer（`idle → running → streaming → done|cancelled|failed`），事件驱动更新。
- **实时**：Tauri event → 内存环形缓冲 → `requestAnimationFrame` 批量 flush 到图表，避免每个采样点触发一次 React 重渲染。页面 `visibilitychange` 隐藏时暂停订阅。

### 7.3 性能要点

- 连接表可能上万行：**服务端分页/过滤优先**，前端虚拟滚动兜底，禁止一次性渲染全量。
- 图表数据用环形缓冲（保留最近 N=1800 个点，即 5s 采样约 2.5 小时）。
- 概览首次进入并发 6~8 个命令，全部走 `Promise.allSettled`，单项失败显示降级提示而非阻塞页面。

### 7.4 报告导出

由 `NetworkRun` + `Evidence` 统一渲染：

| 格式 | 实现 | 用途 |
|---|---|---|
| JSON | `serde_json`（含 spec、工具版本、权限、证据） | 可复现、可流转 |
| HTML | 服务端渲染模板（含交互摘要与折叠证据） | 人工查看、可分享 |
| PDF | HTML → 打印（Tauri Webview 打印 / headless） | 工单附件 |
| CSV | 从 `DataTable` 生成 | 表格数据二次分析 |
| pcap | 直接附原始文件 | 取证 |

---

## 8. 兼容性与降级矩阵

| 环境 | 预期 | 降级路径 |
|---|---|---|
| CentOS 7 / RHEL 7 | `ip` 存在但**不支持 `-j`**（iproute2 较旧） | 走文本变体；`ss` 存在；`nft` 可能无 → 用 iptables |
| Ubuntu 20/22、Debian 11+ | `ip -j` 可用 | 全功能 |
| Rocky / Alma 9 | `ip -j` 可用，`nft` 为主 | iptables 命令可能是 nft 兼容层，解析需兼容 |
| Alpine / 极简容器 | 可能无 `iproute2`、无 `ss`、无 `curl` | `/proc/net/*` + `netstat`（若装）→ 部分能力标记 `NotInstalled` 并给安装建议 |
| 无 `ping` 权限（容器默认） | ICMP 不可用 | 明确提示"ICMP 不可用"，自动改走 TCP 探测作为可达性判据 |
| systemd-resolved / NetworkManager 缺失 | `resolvectl`/`nmcli` 不存在 | 回退 `/etc/resolv.conf` |

**原则**：能力探测在前，UI 按能力渲染（缺失功能隐藏或置灰 + 安装提示），绝不出现"点了没反应"。

## 9. 性能预算

| 指标 | 目标 |
|---|---|
| 概览首屏 | ≤ 2s（并发采集，命中缓存 < 200ms） |
| 诊断启动 | ≤ 300ms（不含命令执行） |
| 单次事实命令 | ≤ 5s 超时 |
| 实时面板 CPU | 空闲时 < 3%，采样节流 ≥ 1s |
| 内存 | 环形缓冲 + 虚拟滚动，万行连接 < 150MB |
| 抓包 | 单文件 ≤ 100MB，远端临时文件自动清理 |

## 10. 测试策略

1. **解析器单测（最重要）**：golden-file，覆盖正常 / 老版本 / 权限不足 / 空输出 / 截断 / 异常字符。新增解析器必须附样本。
2. **集成测试**：Docker 起 CentOS 7、Ubuntu 22、Debian 11、Rocky 9、Alpine 五个靶机，跑通全部 Read/Probe 能力。
3. **故障注入矩阵**（验证 §9 验收标准 2）：DNS 失败、删默认路由、iptables DROP、端口不监听、自签证书域名不匹配、ICMP 全丢 —— 逐一验证 Quick Check 定位到正确层。
4. **安全 fuzz**：对 target/iface/filter 等输入注入 `; rm -rf`、`$()`、反引号、换行、超长串、Unicode 混淆，断言 100% 被 `TargetRejected` 拦截且不产生 shell 执行。
5. **取消与清理**：抓包中途取消 → 断言远端进程已退出、临时文件已删除、审计记录完整。
6. **性能**：大连接数（1 万行）与大接口数（20+）主机上的首屏与滚动帧率。

## 11. 实施计划

| 阶段 | 交付 | 建议工时 |
|---|---|---|
| M0 地基 | `net-domain` + `net-parse` + `net-registry` 骨架 + golden 测试框架 | 5 人日 |
| M1 事实中心 | 能力探测、接口/地址/路由/DNS/监听/连接、概览页与连接页 | 12 人日 |
| M2 诊断台 | Quick Check 六层、DNS、traceroute、HTTP 分阶段、证书、结论卡 | 12 人日 |
| M3 留痕 | 实时速率、Run 落库、历史对比、报告导出（JSON/HTML/CSV） | 10 人日 |
| M4 取证 | 抓包、MTR、扫描（含授权流）、conntrack、ethtool、防火墙摘要 | 12 人日 |
| M5 打磨 | 提权体验、安装提示、兼容矩阵回归、PDF 导出、i18n | 8 人日 |

## 12. 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| 远端工具缺失/版本差异 | 功能不可用或解析错 | 能力探测 + 多变体 + 明确降级提示（§8），不假设默认安装 |
| ICMP/抓包权限受限 | 核心探测失败 | 默认 TCP 可达性判据；需提权能力显式标记与授权 |
| 文本解析脆弱 | 版本升级后解析失败 | 优先 JSON；解析器 golden 测试；`ParseFailed` 上报原始样本便于快速修复 |
| 抓包/扫描产生大流量触发安全告警 | 运维风险 | 默认关闭、范围确认、速率上限、体积上限、审计 |
| SSH exec 阻塞影响交互终端 | 体验劣化 | 独立 channel + 并发限流 + 长任务隔离 |
| trippy API 未稳定 | 依赖升级破裂 | 锁定版本 + feature 隔离 + 兼容测试；短期用系统 traceroute |
| 桌面端跨平台本地诊断（macOS/Windows 提权） | 本地能力不一致 | 本地只保留非特权 TCP/HTTP/DNS；特权能力留给远端与 sidecar |
| 无 agent 导致 per-process 流量精度受限 | `flow.top` 只能短采样，无法长期归因 | 明确标注"短采样"语义与采样窗口；连接级流量用 `ss -p` + `/proc` 关联兜底 |

**范围边界（已确认）**：不引入远端 agent，不引入 eBPF。`ExecPoint` 只有 `Local` 与 `Ssh` 两个取值，无需为第三种执行点预留抽象层；若未来确有需求，再以新增枚举变体的方式扩展，当前不为假设需求付出设计成本。
