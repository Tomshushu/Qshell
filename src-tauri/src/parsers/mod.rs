use serde::{Deserialize, Serialize};
use regex::Regex;
use std::sync::LazyLock;

// Pre-compiled regex patterns
static PROCESS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"users:\(\("([^"]+)".*pid=(\d+)"#).unwrap());
static NETSTAT_PROCESS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(\d+)/([^\s]+)"#).unwrap());

// ==================== Data Structures ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct ServiceInfo {
    pub name: String,
    pub active: bool,
    pub sub_state: String,
    pub enabled: bool,
    pub description: String,
    // === 服务模块精细化扩展（P0）===
    /// LoadState: loaded / not-found / masked / error / bad-setting
    pub load_state: String,
    /// ActiveState: active / inactive / failed / activating / deactivating / reloading
    pub active_state: String,
    /// UnitFileState: enabled / disabled / static / masked / indirect / generated / unknown
    pub enabled_state: String,
    /// 主进程 PID（0 表示无主进程）
    pub main_pid: Option<i64>,
    /// 运行时长（秒），由 ExecMainStartTimestamp 推导
    pub uptime_seconds: Option<i64>,
    /// Unit 文件路径（FragmentPath）
    pub fragment_path: Option<String>,
    /// 运行用户（User=）
    pub user: Option<String>,
    /// Restart 策略（no/always/on-failure 等）
    pub restart_policy: Option<String>,
    /// 失败结果：Result=exit-code / signal / timeout / start-limit-hit
    pub result: Option<String>,
    /// ExecMainStatus：主进程退出码
    pub exec_main_status: Option<i64>,
    /// NRestarts：最近重启次数
    pub n_restarts: Option<i64>,
    /// CPU 使用率（按需采集，列表默认不填充）
    pub cpu_percent: Option<f64>,
    /// 内存字节（按需采集，列表默认不填充）
    pub memory_bytes: Option<i64>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub user: String,
    pub pid: i64,
    /// 父进程 PID，用于构建进程树
    pub ppid: i64,
    pub cpu: f64,
    pub memory: f64,
    pub vsz: i64,
    pub rss: i64,
    pub stat: String,
    /// 调度优先级（nice 值）
    pub nice: i32,
    /// 进程启动至今的时长（秒，来自 `ps etimes`），用于构造稳定标识 ProcessKey，
    /// 防止 PID 复用导致误杀新进程。
    pub start_time_ticks: i64,
    pub start: String,
    /// 进程所属 cgroup 路径，用于推导 systemd 服务名 / Docker 容器，实现跨模块关联。
    /// Windows 侧无 cgroup，返回空字符串。
    pub cgroup: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub protocol: String,
    pub local_address: String,
    pub port: i64,
    pub state: String,
    pub process_name: String,
    pub pid: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    /// 是否为符号链接。SFTP readdir 的 file_type 已携带该信息，传输递归直接复用，
    /// 避免为每个目录条目额外发一次 stat（大目录下是 1+N 次串行 RTT）。
    #[serde(default)]
    pub is_symlink: bool,
    pub size: i64,
    pub modified_time: String,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    /// 数字 uid/gid（SFTP 服务器未返回用户名/组名时的回退展示）
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
    pub repository: String,
    pub tag: String,
    pub id: String,
    pub created_since: String,
    pub size: String,
    /// 镜像体积（字节）：由 `size` 人类可读串解析而来，用于离线导出超时估算
    pub size_bytes: i64,
    /// 是否被容器引用（任意状态）
    pub in_use: bool,
    /// 是否被运行中的容器引用
    pub used_by_running: bool,
    /// 是否悬空镜像（dangling：repository 或 tag 为 <none>）
    pub dangling: bool,
}

// ==================== Core Parsing Functions ====================

/// Parse `systemctl list-units --type=service --all --no-pager --no-legend` output.
///
/// Input format (each line):
///   NAME                LOAD   ACTIVE   SUB     DESCRIPTION
///   example.service     loaded active   running Example Service
///
/// Fields: name, active (bool), subState, enabled (bool), description
pub fn parse_service_list(output: &str) -> Vec<ServiceInfo> {
    let mut services = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }

        let name = parts[0].to_string();
        if !name.ends_with(".service") {
            continue;
        }

        // systemctl list-units columns: NAME LOAD ACTIVE SUB DESCRIPTION
        // LOAD = parts[1] (loaded/not-found/masked), ACTIVE = parts[2] (active/inactive/failed)
        // NOTE: `systemctl list-units` 不报告开机自启状态；enabled / enabledState 由
        // `systemctl list-unit-files` 的真实 UnitFileState 在 services_list 中合并填充，
        // 不再用 ACTIVE 冒充（此前 enabled = active 是错误语义）。
        services.push(ServiceInfo {
            name,
            active: parts[2] == "active",
            sub_state: parts[3].to_string(),
            enabled: false,
            description: parts[4..].join(" "),
            load_state: parts[1].to_string(),
            active_state: parts[2].to_string(),
            ..Default::default()
        });
    }

    services
}

/// 解析 `systemctl list-unit-files --type=service --no-legend --no-pager` 输出。
///
/// 每行格式：`NAME.service    enabled|disabled|static|masked|indirect|generated`
/// 这是开机自启（UnitFileState）的真实来源，与运行状态无关。
pub fn parse_unit_file_states(output: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("").to_string();
        let state = parts.next().unwrap_or("").to_string();
        if !name.is_empty() && !state.is_empty() {
            map.insert(name, state);
        }
    }
    map
}

/// 解析 `systemctl show [--property=...] [unit]` 输出为 Key -> Value 映射。
///
/// 输出为 `Key=Value` 行（多个 unit 时以空行分块，本函数合并为扁平映射）；
/// 值可能为空（例如 masked unit 的 FragmentPath）。
pub fn parse_systemd_props(output: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    map
}

/// 解析 `systemctl show`（多个 unit）的分块输出为属性表数组。
///
/// `systemctl show u1 u2 ...` 会为每个 unit 输出一块 `Key=Value` 行，块之间以
/// 空行分隔。批量采集（资源 / 依赖状态）时用它可以一次命令拿全部 unit，
/// 避免为每个 unit 单独发起 SSH 执行。
pub fn parse_systemd_prop_blocks(output: &str) -> Vec<std::collections::HashMap<String, String>> {
    let mut blocks: Vec<std::collections::HashMap<String, String>> = Vec::new();
    let mut cur: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            if !cur.is_empty() {
                blocks.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            cur.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    if !cur.is_empty() {
        blocks.push(cur);
    }
    blocks
}

/// `ps aux` column layout (0-based, whitespace-separated):
///   0=USER 1=PID 2=%CPU 3=%MEM 4=VSZ 5=RSS 6=TTY 7=STAT 8=START 9=TIME 10..=COMMAND
/// COMMAND is the remainder of the line (may contain spaces).
const PS_AUX_CMD_COL: usize = 10;

/// Parse `ps aux` output.
///
/// Input format (header + data lines):
///   USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
///   root         1  0.0  0.1 169344 13064 ?        Ss   Jun10   0:15 /sbin/init
///
/// Fields: user, pid, cpu, memory, vsz, rss, stat, start, command
pub fn parse_process_list(output: &str) -> Vec<ProcessInfo> {
    let mut processes = std::collections::HashMap::<i64, ProcessInfo>::new();

    // Skip header line
    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < PS_AUX_CMD_COL + 1 {
            continue;
        }

        let process = ProcessInfo {
            user: parts[0].to_string(),
            pid: parts[1].parse().unwrap_or(0),
            ppid: 0,
            cpu: parts[2].parse().unwrap_or(0.0),
            memory: parts[3].parse().unwrap_or(0.0),
            vsz: parts[4].parse().unwrap_or(0),
            rss: parts[5].parse().unwrap_or(0),
            stat: parts[7].to_string(),
            nice: 0,
            start_time_ticks: 0,
            start: parts[8].to_string(),
            cgroup: String::new(),
            command: parts[PS_AUX_CMD_COL..].join(" "),
        };
        if let Some(existing) = processes.get_mut(&process.pid) {
            // CPU/内存双排序采集会让同一 PID 出现两次，保留两个维度的最高观测值。
            existing.cpu = existing.cpu.max(process.cpu);
            existing.memory = existing.memory.max(process.memory);
            existing.vsz = existing.vsz.max(process.vsz);
            existing.rss = existing.rss.max(process.rss);
        } else {
            processes.insert(process.pid, process);
        }
    }

    let mut processes: Vec<_> = processes.into_values().collect();
    processes.sort_by_key(|process| process.pid);
    processes
}

/// Parse Linux `ps -eo pid,ppid,user:32,%cpu,%mem,vsz,rss,stat,nice,etimes,args,cgroup` output.
///
/// Compared with `parse_process_list` (ps aux layout), this variant also carries
/// `ppid` / `nice` / `etimes` so the frontend can build a process tree and construct a
/// stable `ProcessKey = pid + startTimeTicks` to defend against PID reuse.
///
/// Layout（10 个固定列 + args + 末尾 cgroup）：
///   PID  PPID  USER  %CPU  %MEM  VSZ  RSS  STAT  NI  ETIMES  COMMAND...  CGROUP
///
/// `cgroup` 置于末尾，因此恒为最后一个 token，`args` 吸收中间全部 token。
pub fn parse_process_list_linux(output: &str) -> Vec<ProcessInfo> {
    let mut map = std::collections::HashMap::<i64, ProcessInfo>::new();

    // Skip header line
    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        // 10 个固定列 + 末尾的 cgroup；命令为空时长度恰为 11
        if parts.len() < 11 {
            continue;
        }

        let pid = parts[0].parse().unwrap_or(0);
        if pid == 0 {
            continue;
        }

        // cgroup 采集自 args 之后，恒为最后一个 token；args 吸收其余所有 token，
        // 即使命令为空（内核线程）也能正确切分。
        let last = parts.len() - 1;
        let process = ProcessInfo {
            user: parts[2].to_string(),
            pid,
            ppid: parts[1].parse().unwrap_or(0),
            cpu: parts[3].parse().unwrap_or(0.0),
            memory: parts[4].parse().unwrap_or(0.0),
            vsz: parts[5].parse().unwrap_or(0),
            rss: parts[6].parse().unwrap_or(0),
            stat: parts[7].to_string(),
            nice: parts[8].parse().unwrap_or(0),
            start_time_ticks: parts[9].parse().unwrap_or(0),
            start: String::new(),
            cgroup: parts[last].to_string(),
            command: parts[10..last].join(" "),
        };
        if let Some(existing) = map.get_mut(&pid) {
            // CPU/内存双排序采集会让同一 PID 出现两次，保留两个维度的最高观测值。
            existing.cpu = existing.cpu.max(process.cpu);
            existing.memory = existing.memory.max(process.memory);
            existing.vsz = existing.vsz.max(process.vsz);
            existing.rss = existing.rss.max(process.rss);
        } else {
            map.insert(pid, process);
        }
    }

    let mut processes: Vec<_> = map.into_values().collect();
    processes.sort_by_key(|process| process.pid);
    processes
}

/// Parse a local address:port string from `ss` output into (address, port).
///
/// Supported formats:
///   - `0.0.0.0:22`       (IPv4)
///   - `127.0.0.53%lo:53` (IPv4 with interface scope)
///   - `:::80`            (IPv6 any, unbracketed)
///   - `::1:22`           (IPv6 loopback, unbracketed)
///   - `[::1]:22`         (IPv6, bracketed)
///   - `[fe80::1%eth0]:22`(IPv6 with interface scope, bracketed)
///   - `*:*`              (wildcard)
fn parse_local_addr_port(local_addr: &str) -> (String, i64) {
    // Bracketed IPv6: [address]:port or [address%ifname]:port
    if local_addr.starts_with('[') {
        if let Some(close) = local_addr.find(']') {
            let mut addr = &local_addr[1..close];
            if let Some(pct) = addr.find('%') {
                addr = &addr[..pct];
            }
            let rest = &local_addr[close + 1..];
            let port_str = rest.strip_prefix(':').unwrap_or(rest);
            let port: i64 = port_str.parse().unwrap_or(0);
            return (addr.to_string(), port);
        }
    }
    // Unbracketed: split at the last ':' (correct for both IPv4 and IPv6
    // because `ss` uses the last colon as the address/port separator).
    match local_addr.rfind(':') {
        Some(idx) => {
            let mut addr = &local_addr[..idx];
            // Strip interface scope / device suffix like %lo or %eth0 (e.g. 127.0.0.53%lo -> 127.0.0.53)
            if let Some(pct) = addr.find('%') {
                addr = &addr[..pct];
            }
            let port_str = &local_addr[idx + 1..];
            let port: i64 = port_str.parse().unwrap_or(0);
            let addr = if addr.is_empty() || addr == "*" {
                "0.0.0.0"
            } else {
                addr
            };
            (addr.to_string(), port)
        }
        None => {
            let mut addr = local_addr;
            if let Some(pct) = addr.find('%') {
                addr = &addr[..pct];
            }
            (if addr.is_empty() || addr == "*" { "0.0.0.0".to_string() } else { addr.to_string() }, 0)
        }
    }
}

/// Parse `ss -tunlp` output.
///
/// Input format:
///   Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process
///   tcp   LISTEN 0      128    0.0.0.0:22          0.0.0.0:*          users:(("sshd",pid=1234,fd=3))
///
/// Fields: protocol, localAddress, port, state, processName, pid
pub fn parse_port_list(output: &str) -> Vec<PortInfo> {
    let mut ports = Vec::new();

    // Skip header line
    for line in output.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let (addr, port) = parse_local_addr_port(parts[4]);

        // Extract process name and pid from users:(("name",pid=1234,fd=N)) or netstat PID/Program
        let (process_name, pid) = if let Some(caps) = PROCESS_RE.captures(line) {
            (
                caps.get(1).map(|m| m.as_str().to_string()).unwrap_or_default(),
                caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
            )
        } else if let Some(caps) = NETSTAT_PROCESS_RE.captures(line) {
            (
                caps.get(2).map(|m| m.as_str().to_string()).unwrap_or_default(),
                caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0),
            )
        } else {
            (String::new(), 0)
        };

        ports.push(PortInfo {
            protocol: parts[0].to_string(),
            local_address: if addr.is_empty() { "0.0.0.0".to_string() } else { addr },
            port,
            state: parts[1].to_string(),
            process_name,
            pid,
        });
    }

    ports
}

/// Parse `ls -la --time-style=long-iso` output.
///   drwxr-xr-x  6 root root  4096 2024-01-15 10:30 .
///   -rw-r--r--  1 root root  1234 2024-01-15 10:30 file.txt
///
/// Fields: name, path, isDirectory, size, modifiedTime, permissions, owner, group
/// Sort: directories first, then by name (case-insensitive)
///
/// 新格式（P0-2 安全修复后）：使用 `find -print0` + `stat -c` 结构化输出，
/// 记录间用 \x1f（Unit Separator）分隔，字段间用 \x1e（Record Separator）分隔。
/// 这两个 ASCII 控制字符不会出现在合法文件名中，可彻底防御含换行符的恶意文件名注入。
///
/// 字段顺序：name \x1e type \x1e size \x1e mode \x1e owner \x1e group \x1e mtime
/// type 为 stat -c %F 输出（如 "directory"/"regular file"/"symbolic link"）。
///
/// 输出结构：rec1 \x1f rec2 \x1f ... \x1f \x1f symlinks_part
/// 空记录（连续两个 \x1f）作为 symlinks 段的分界。
///
/// 兼容旧格式（ls -la 输出 + \x1f + symlinks）：若输出不以 \x1e 结构开头，
/// 回退到旧的 split_whitespace 解析路径（已废弃，仅向后兼容）。
pub fn parse_file_list(output: &str, dir_path: &str) -> Vec<FileEntry> {
    let mut files = Vec::new();
    let mut symlink_dirs = std::collections::HashSet::new();

    // 检测格式：新格式包含 \x1e 字段分隔符，旧格式只有 \x1f 段分隔符
    let is_new_format = output.contains('\x1e');

    if is_new_format {
        // === 新格式解析 ===
        // 按 \x1f 切分：前面是文件记录，遇到空记录后是 symlinks 段
        let segments: Vec<&str> = output.split('\x1f').collect();
        let mut symlinks_started = false;

        for seg in segments {
            if seg.is_empty() {
                // 空记录标志着文件段结束，后续为 symlinks 段
                symlinks_started = true;
                continue;
            }

            if symlinks_started {
                // symlinks 段：每行一个指向目录的符号链接绝对路径
                for line in seg.lines() {
                    let line = line.trim();
                    if !line.is_empty() && !line.starts_with("SW_TEST_END") {
                        symlink_dirs.insert(line.to_string());
                    }
                }
                continue;
            }

            // 文件记录段：按 \x1e 切分字段
            let fields: Vec<&str> = seg.split('\x1e').collect();
            if fields.len() < 7 {
                continue;
            }

            // 字段顺序：name, type, size, mode, owner, group, mtime
            // name 为 stat -c %n 输出，可能是绝对路径，取 basename
            let raw_name = fields[0];
            // 取最后一非空行，忽略 SW_TEST_START / SW_ITEM_COUNT 等头部标志
            let clean_raw_name = raw_name
                .lines()
                .map(|l| l.trim()).rfind(|l| !l.is_empty() && !l.starts_with("SW_TEST_START") && !l.starts_with("SW_ITEM_COUNT"))
                .unwrap_or("");

            let name = basename(clean_raw_name);
            if name.is_empty() {
                continue;
            }

            let file_type = fields[1].trim();
            let size: i64 = fields[2].trim().parse().unwrap_or(0);
            let permissions = fields[3].trim().to_string();
            let owner = fields[4].trim().to_string();
            let group = fields[5].trim().to_string();
            
            let raw_mtime = fields[6].trim();
            let modified_time = if raw_mtime.len() >= 19 {
                raw_mtime[..19].to_string()
            } else {
                raw_mtime.to_string()
            };

            // 跳过 . 和 ..
            if name == "." || name == ".." {
                continue;
            }

            // 判定类型：stat -c %F 输出 "directory" / "regular file" / "symbolic link" 等
            let is_symlink = file_type.contains("symbolic link");
            let mut is_directory = file_type.contains("directory");

            // 路径拼接：Linux 用 '/'，Windows 用 '\'（盘符路径如 C:\Users）
            // 检测 dir_path 是否为 Windows 路径（盘符开头或 UNC 路径）
            let is_windows_path = dir_path.len() >= 3 && {
                let b = dir_path.as_bytes();
                b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
            } || dir_path.starts_with("\\\\") || dir_path.starts_with("//");

            let file_path = if is_windows_path {
                // Windows 路径拼接：规范化为反斜杠
                let base = dir_path.trim_end_matches('\\').trim_end_matches('/');
                format!("{}\\{}", base, name)
            } else if dir_path == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", dir_path, name)
            };

            // 若符号链接指向目录，标记为目录
            if is_symlink && symlink_dirs.contains(&file_path) {
                is_directory = true;
            }

            files.push(FileEntry {
                name,
                path: file_path,
                is_directory,
                is_symlink,
                size,
                modified_time,
                permissions,
                owner,
                group,
                uid: None,
                gid: None,
            });
        }
    } else {
        // === 旧格式回退（ls -la 输出，向后兼容）===
        // 注意：旧格式存在换行文件名注入风险，新部署应使用新格式
        let mut ls_output = output;
        if let Some(pos) = output.find('\x1f') {
            ls_output = &output[..pos];
            let symlinks_part = &output[pos + 1..];
            for line in symlinks_part.lines() {
                let line = line.trim();
                if !line.is_empty() {
                    symlink_dirs.insert(line.to_string());
                }
            }
        } else if let Some(pos) = output.find("===SYMLINKS===") {
            ls_output = &output[..pos];
            let symlinks_part = &output[pos + "===SYMLINKS===".len()..];
            for line in symlinks_part.lines() {
                let line = line.trim();
                if !line.is_empty() {
                    symlink_dirs.insert(line.to_string());
                }
            }
        }

        for line in ls_output.lines().skip(1) {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 8 {
                continue;
            }

            let permissions = parts[0];
            let is_symlink = permissions.starts_with('l');
            let mut is_directory = permissions.starts_with('d');
            let owner = parts[2].to_string();
            let group = parts[3].to_string();
            let size: i64 = parts[4].parse().unwrap_or(0);
            let date = format!("{} {}", parts[5], parts[6]);
            let mut name = parts[7..].join(" ");

            if is_symlink {
                if let Some(pos) = name.find(" -> ") {
                    name = name[..pos].to_string();
                }
            }

            if name == "." || name == ".." {
                continue;
            }

            let file_path = if dir_path == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", dir_path, name)
            };

            if is_symlink && symlink_dirs.contains(&file_path) {
                is_directory = true;
            }

            files.push(FileEntry {
                name,
                path: file_path,
                is_directory,
                is_symlink,
                size,
                modified_time: date,
                permissions: permissions.to_string(),
                owner,
                group,
                uid: None,
                gid: None,
            });
        }
    }

    // Sort: directories first, then by name (case-insensitive)
    files.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    files
}

/// 取路径的 basename："/a/b/c" → "c"，"c" → "c"，"" → ""
/// 用于从 stat -c %n 的绝对路径输出中提取文件名
fn basename(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    // 标准化尾部斜杠后取最后一段
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(pos) => trimmed[pos + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// Parse `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.CreatedAt}}'` output.
///
/// Input format (pipe-delimited):
///   abc123|my-container|nginx:latest|Up 2 hours|running|0.0.0.0:80->80/tcp|2024-01-15 10:30:00
///
/// Fields: id, name, image, status, state, ports, createdAt
pub fn parse_docker_ps(output: &str) -> Vec<DockerContainer> {
    let mut containers = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 7 {
            continue;
        }

        containers.push(DockerContainer {
            id: parts[0].to_string(),
            name: parts[1].to_string(),
            image: parts[2].to_string(),
            status: parts[3].to_string(),
            state: parts[4].to_string(),
            ports: parts[5].to_string(),
            created_at: parts[6].to_string(),
        });
    }

    containers
}

/// Parse `docker images --format '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedSince}}|{{.Size}}'` output.
///
/// Input format (pipe-delimited):
///   nginx|latest|abc123|2 weeks ago|187MB
///
/// Fields: repository, tag, id, createdSince, size
///
/// `used_image_ids`：被容器引用的镜像 ID 集合（短 ID 前 12 位即可）
/// `running_image_ids`：被运行中容器引用的镜像 ID 集合
/// 用于在前端区分镜像状态：运行中/已停止/悬空/未使用
pub fn parse_docker_images(
    output: &str,
    used_image_ids: &std::collections::HashSet<String>,
    running_image_ids: &std::collections::HashSet<String>,
) -> Vec<DockerImage> {
    let mut images = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 5 {
            continue;
        }

        let id = parts[2].to_string();
        // 短 ID 前 12 位用于匹配容器引用
        let short_id = id.get(..12).unwrap_or(&id).to_string();
        let in_use = used_image_ids.contains(&short_id);
        let used_by_running = running_image_ids.contains(&short_id);
        // 悬空镜像：repository 或 tag 为 <none>
        let dangling = parts[0] == "<none>" || parts[1] == "<none>";

        images.push(DockerImage {
            repository: parts[0].to_string(),
            tag: parts[1].to_string(),
            id,
            created_since: parts[3].to_string(),
            size: parts[4].to_string(),
            size_bytes: human_size_to_bytes(parts[4]),
            in_use,
            used_by_running,
            dangling,
        });
    }

    images
}

/// 将 docker 输出的人类可读体积（如 "1.24GB"、"512B"、"7.5kB"）解析为字节数。
/// docker/go-units 采用十进制倍数（1KB=1000）。解析失败返回 0。
fn human_size_to_bytes(s: &str) -> i64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    // 分离数字部分与单位部分
    let split_idx = s.find(|c: char| !(c.is_ascii_digit() || c == '.'));
    let (num_str, unit) = match split_idx {
        Some(i) => (&s[..i], s[i..].trim().to_ascii_lowercase()),
        None => (s, String::new()),
    };
    let num: f64 = match num_str.parse() {
        Ok(n) => n,
        Err(_) => return 0,
    };
    let mult: f64 = match unit.as_str() {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1_000.0,
        "m" | "mb" | "mib" => 1_000_000.0,
        "g" | "gb" | "gib" => 1_000_000_000.0,
        "t" | "tb" | "tib" => 1_000_000_000_000.0,
        "p" | "pb" | "pib" => 1_000_000_000_000_000.0,
        _ => return 0,
    };
    (num * mult) as i64
}

#[cfg(test)]
mod docker_image_tests {
    use super::*;

    #[test]
    fn test_human_size_to_bytes() {
        assert_eq!(human_size_to_bytes("512B"), 512);
        assert_eq!(human_size_to_bytes("1.24GB"), 1_240_000_000);
        assert_eq!(human_size_to_bytes("7.5kB"), 7_500);
        assert_eq!(human_size_to_bytes("0B"), 0);
        assert_eq!(human_size_to_bytes("2TB"), 2_000_000_000_000);
        assert_eq!(human_size_to_bytes("garbage"), 0);
    }
}

// ==================== Unit Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_service_list() {
        let input = "\
  nginx.service             loaded active   running A high performance web server
  ssh.service               loaded inactive dead   OpenSSH Daemon
  docker.service            loaded active   running Docker Application Container Engine";
        let result = parse_service_list(input);
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].name, "nginx.service");
        assert!(result[0].active);
        assert_eq!(result[0].sub_state, "running");
        assert!(!result[0].enabled); // parse_service_list 不填充 enabled，由 list-unit-files 填充
        assert_eq!(result[0].description, "A high performance web server");

        assert_eq!(result[1].name, "ssh.service");
        assert!(!result[1].active);
        assert_eq!(result[1].sub_state, "dead");
        assert!(!result[1].enabled); // ACTIVE=inactive → not enabled

        assert_eq!(result[2].name, "docker.service");
        assert!(result[2].active);
    }

    #[test]
    fn test_parse_service_list_skips_non_service() {
        let input = "snapd.socket                loaded active   listening Socket activation for snappy daemon";
        let result = parse_service_list(input);
        assert_eq!(result.len(), 0); // .socket should be skipped
    }

    #[test]
    fn test_parse_process_list() {
        let input = "\
USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1 169344 13064 ?        Ss   Jun10   0:15 /sbin/init
www-data  1234  2.5  1.3  67890 45678 ?        S    10:30   0:01 nginx: worker process";
        let result = parse_process_list(input);
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].user, "root");
        assert_eq!(result[0].pid, 1);
        assert_eq!(result[0].cpu, 0.0);
        assert_eq!(result[0].memory, 0.1);
        assert_eq!(result[0].vsz, 169344);
        assert_eq!(result[0].rss, 13064);
        assert_eq!(result[0].stat, "Ss");
        assert_eq!(result[0].start, "Jun10");
        assert_eq!(result[0].command, "/sbin/init");

        assert_eq!(result[1].user, "www-data");
        assert_eq!(result[1].pid, 1234);
        assert_eq!(result[1].cpu, 2.5);
        assert_eq!(result[1].command, "nginx: worker process");
    }

    #[test]
    fn test_parse_port_list() {
        let input = "\
Netid State   Recv-Q  Send-Q   Local Address:Port    Peer Address:Port  Process
tcp   LISTEN  0       128      0.0.0.0:22             0.0.0.0:*          users:((\"sshd\",pid=1234,fd=3))
tcp   LISTEN  0       511      :::80                  :::*               users:((\"nginx\",pid=5678,fd=6))
udp   UNCONN  0       0        0.0.0.0:68             0.0.0.0:*          users:((\"dhclient\",pid=999,fd=4))";
        let result = parse_port_list(input);
        assert_eq!(result.len(), 3);

        assert_eq!(result[0].protocol, "tcp");
        assert_eq!(result[0].local_address, "0.0.0.0");
        assert_eq!(result[0].port, 22);
        assert_eq!(result[0].state, "LISTEN");
        assert_eq!(result[0].process_name, "sshd");
        assert_eq!(result[0].pid, 1234);

        assert_eq!(result[1].protocol, "tcp");
        assert_eq!(result[1].port, 80);
        assert_eq!(result[1].local_address, "::");
        assert_eq!(result[1].process_name, "nginx");

        assert_eq!(result[2].protocol, "udp");
        assert_eq!(result[2].port, 68);
    }

    #[test]
    fn test_parse_file_list_windows() {
        // Output with SW_TEST_START, SW_ITEM_COUNT, and newlines in segments
        let input = "\
SW_TEST_START\r
SW_ITEM_COUNT=2\r
file1.txt\x1eregular file\x1e123\x1e---\x1e\x1e\x1e2023-01-01 12:00:00\r
\x1f\r
file2.txt\x1edirectory\x1e0\x1e---\x1e\x1e\x1e2023-01-01 12:00:00\r
\x1f\r
\x1f\r
SW_TEST_END\r
";
        let result = parse_file_list(input, "C:\\");
        assert_eq!(result.len(), 2);

        // Directories first, so file2.txt (directory) comes before file1.txt (regular file)
        assert_eq!(result[0].name, "file2.txt");
        assert_eq!(result[0].path, "C:\\file2.txt");
        assert_eq!(result[0].size, 0);
        assert!(result[0].is_directory);

        assert_eq!(result[1].name, "file1.txt");
        assert_eq!(result[1].path, "C:\\file1.txt");
        assert_eq!(result[1].size, 123);
        assert!(!result[1].is_directory);
        assert_eq!(result[1].modified_time, "2023-01-01 12:00:00");
    }
}
