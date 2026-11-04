// src-tauri/src/mcp/guard.rs
//
// Qshell Rust 原生端侧零信任指令决策、出向 DLP 脱敏与路径安全网关
// 严格对齐 @qshell/policy 规范，作为主进程防御纵深（Defense in Depth）

use regex::Regex;
use std::sync::OnceLock;

pub struct GuardResult {
    pub allowed: bool,
    pub reason: String,
    pub segment: Option<String>,
    pub hint: Option<String>,
}

static ABSOLUTE_BLOCK_REGEX: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
static SENSITIVE_PATH_REGEX: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
static DLP_PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn get_block_regexes() -> &'static Vec<(Regex, &'static str)> {
    ABSOLUTE_BLOCK_REGEX.get_or_init(|| {
        vec![
            (
                Regex::new(r"rm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:/\s*$|/\*|/\.\*)").unwrap(),
                "检测到针对根目录的破坏性删除操作 (rm -rf /)，永久硬阻断！",
            ),
            (
                Regex::new(r":\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:").unwrap(),
                "检测到 Fork 炸弹代码，永久硬阻断！",
            ),
            (
                Regex::new(r">\s*/dev/(?:sd[a-z0-9]|nvme[0-9]n[0-9]|vd[a-z0-9]|hd[a-z0-9])").unwrap(),
                "检测到向物理磁盘直接写入，永久硬阻断！",
            ),
            (
                Regex::new(r"dd\s+(?:if=[^ \t\r\n]+\s+)?of=/dev/(?:sd[a-z0-9]|nvme[0-9]n[0-9]|vd[a-z0-9]|hd[a-z0-9]|null\b)").unwrap(),
                "检测到覆写物理磁盘操作，永久硬阻断！",
            ),
            (
                Regex::new(r"chmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+777\s+/\s*$").unwrap(),
                "检测到全盘递归放开 777 权限，永久硬阻断！",
            ),
            (
                Regex::new(r"\b(?:reboot|shutdown|poweroff|init\s+0|init\s+6|halt)\b").unwrap(),
                "检测到系统重启/关机操作，只读排障网关严禁重启宿主机！",
            ),
            (
                Regex::new(r"\bkill\s+-(?:9|KILL|s\s+9)\b|\bkillall\b|\bpkill\b").unwrap(),
                "检测到进程强杀操作，只读排障网关禁止终止进程！",
            ),
        ]
    })
}

fn get_sensitive_path_regexes() -> &'static Vec<(Regex, &'static str)> {
    SENSITIVE_PATH_REGEX.get_or_init(|| {
        vec![
            (
                Regex::new(r"/(?:etc/shadow|etc/gshadow|etc/master\.passwd)\b").unwrap(),
                "禁止读取系统用户密码哈希表 (/etc/shadow)",
            ),
            (
                Regex::new(r"/(?:etc/sudoers(?:\.d)?)\b").unwrap(),
                "禁止访问特权提权配置 (/etc/sudoers)",
            ),
            (
                Regex::new(r"\.ssh/(?:id_[a-zA-Z0-9_-]+|.*\.pem|.*\.key|authorized_keys|known_hosts)\b").unwrap(),
                "禁止访问任何 SSH 密钥与凭证文件 (~/.ssh/*)",
            ),
            (
                Regex::new(r"\.(?:bash_history|zsh_history|history)\b").unwrap(),
                "禁止读取终端历史记录文件",
            ),
            (
                Regex::new(r"/(?:proc/kcore|proc/kmem|dev/mem|dev/kmem)\b").unwrap(),
                "禁止访问底层内核物理内存映射",
            ),
            (
                Regex::new(r"/(?:var/run/secrets)\b").unwrap(),
                "禁止读取 Kubernetes Service Account 鉴权令牌",
            ),
            (
                Regex::new(r"\.(?:env[.\-_a-zA-Z0-9]*)\b").unwrap(),
                "禁止读取环境变量明文配置文件 (.env)",
            ),
        ]
    })
}

fn get_dlp_patterns() -> &'static Vec<(Regex, &'static str)> {
    DLP_PATTERNS.get_or_init(|| {
        vec![
            (
                Regex::new(r"(?i)-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----").unwrap(),
                "[REDACTED_PRIVATE_KEY]",
            ),
            (
                Regex::new(r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}").unwrap(),
                "[REDACTED_JWT_TOKEN]",
            ),
            (
                Regex::new(r"\b(AKIA[0-9A-Z]{16})\b").unwrap(),
                "[REDACTED_AWS_KEY]",
            ),
            (
                Regex::new(r"\b(LTAI[0-9A-Za-z]{16,24})\b").unwrap(),
                "[REDACTED_ALIYUN_KEY]",
            ),
            (
                Regex::new(r"\b(sk-[a-zA-Z0-9_-]{20,96})\b").unwrap(),
                "[REDACTED_API_KEY]",
            ),
            (
                Regex::new(r#"(?i)(["']?(?:password|passwd|pwd|secret|token|api_?key)["']?\s*[:=]\s*["']?)([^"' \t\r\n]{3,})(["']?)"#).unwrap(),
                "$1[REDACTED_SECRET]$3",
            ),
        ]
    })
}

/// 审查单条执行命令是否安全放行
pub fn evaluate_command(command: &str) -> GuardResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return GuardResult {
            allowed: false,
            reason: "命令不能为空".to_string(),
            segment: None,
            hint: None,
        };
    }

    // 1. 毁灭性硬阻断检查
    for (re, reason) in get_block_regexes() {
        if re.is_match(trimmed) {
            return GuardResult {
                allowed: false,
                reason: reason.to_string(),
                segment: Some(trimmed.to_string()),
                hint: Some("排障请使用只读查询命令（如 systemctl status, journalctl, ss 等）".to_string()),
            };
        }
    }

    // 2. 敏感凭据路径拦截
    for (re, reason) in get_sensitive_path_regexes() {
        if re.is_match(trimmed) {
            return GuardResult {
                allowed: false,
                reason: reason.to_string(),
                segment: Some(trimmed.to_string()),
                hint: Some("禁止直接抓取机密文件，请查询服务状态或业务日志".to_string()),
            };
        }
    }

    // 3. 子 Shell 嵌套阻断 ($() 与 反引号)
    if trimmed.contains("$(") || trimmed.contains('`') || trimmed.contains("<(") || trimmed.contains(">(") {
        return GuardResult {
            allowed: false,
            reason: "检测到隐藏执行的子 Shell 语法 ($() / 反引号 / 进程替换)，为防注入已坚决拦截！".to_string(),
            segment: Some(trimmed.to_string()),
            hint: Some("请将命令拆解为扁平单一排查语句下发".to_string()),
        };
    }

    // 4. 后台脱钩符拦截 (&)
    let has_background = trimmed.split('&').any(|s| {
        let after = s.trim();
        // 允许 2>&1
        !after.starts_with('1') && !after.starts_with('2') && !s.ends_with('>')
    }) && trimmed.contains('&') && !trimmed.contains("2>&1") && !trimmed.contains("&&");
    if has_background {
        return GuardResult {
            allowed: false,
            reason: "检测到后台异步运行符 (&)，非交互排障网关严禁启动脱钩进程！".to_string(),
            segment: Some(trimmed.to_string()),
            hint: None,
        };
    }

    // 5. 交互式 TUI 拦截 (避免后台挂起)
    let tui_list = ["top", "htop", "iftop", "iotop", "vim", "vi", "nano", "less", "more", "watch"];
    let first_token = trimmed.split_whitespace().next().unwrap_or("").to_lowercase();
    if tui_list.contains(&first_token.as_str()) {
        return GuardResult {
            allowed: false,
            reason: format!("「{}」为全屏交互式持续程序，后台通道运行将导致会话永久挂起！", first_token),
            segment: Some(trimmed.to_string()),
            hint: Some("请在 Qshell 终端窗口中直接运行该命令，或使用非交互参数（如 top -b -n 1）".to_string()),
        };
    }

    // 6. 深度防卡死限制 (du 强制 --max-depth=1, find 阻断 -exec)
    if first_token == "du" && !trimmed.contains("--max-depth") && !trimmed.contains("-d") {
        return GuardResult {
            allowed: false,
            reason: "执行 du 必须指定深度限制 (--max-depth=1)，严禁全盘裸跑消耗海量磁盘 I/O！".to_string(),
            segment: Some(trimmed.to_string()),
            hint: Some("推荐写法：du -h --max-depth=1 /var/log | sort -hr | head -n 10".to_string()),
        };
    }
    if first_token == "find" && (trimmed.contains("-exec") || trimmed.contains("-delete")) {
        return GuardResult {
            allowed: false,
            reason: "find 命令严禁携带 -exec 或 -delete 执行与破坏参数！".to_string(),
            segment: Some(trimmed.to_string()),
            hint: Some("只读查找请使用：find /dir -maxdepth 2 -name '*.log'".to_string()),
        };
    }

    GuardResult {
        allowed: true,
        reason: "只读网关审查通过".to_string(),
        segment: None,
        hint: None,
    }
}

/// 审查 SFTP 读取路径是否在白名单与安全边界内
pub fn validate_sftp_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径不能为空".to_string());
    }

    let normalized = trimmed.replace('\\', "/");

    // 必须为绝对 POSIX 路径或 Windows 盘符路径
    let is_posix = normalized.starts_with('/');
    let is_win = normalized.len() >= 3
        && normalized.chars().next().map_or(false, |c| c.is_ascii_alphabetic())
        && &normalized[1..3] == ":/";

    if !is_posix && !is_win {
        return Err(format!("必须提供绝对路径，拒绝相对路径「{}」", trimmed));
    }

    // 严禁路径穿越
    if normalized.split('/').any(|seg| seg == "..") {
        return Err(format!("检测到路径穿越符 '..'，禁止越界访问父级目录「{}」", trimmed));
    }

    // 敏感凭证黑名单硬拦截
    for (re, reason) in get_sensitive_path_regexes() {
        if re.is_match(&normalized) {
            return Err(format!("[安全策略硬拦截] {}", reason));
        }
    }

    // POSIX 白名单前缀审查
    if is_posix {
        let allowed_prefixes = [
            "/etc/", "/var/log/", "/var/www/", "/opt/", "/usr/local/",
            "/app/", "/apps/", "/srv/", "/home/", "/root/", "/data/", "/mnt/",
        ];
        let whitelisted = allowed_prefixes.iter().any(|prefix| normalized.starts_with(prefix));
        if !whitelisted {
            return Err(format!(
                "[白名单拦截] 目标路径「{}」不在只读白名单许可目录中（允许目录：{}）",
                normalized,
                allowed_prefixes.join(", ")
            ));
        }
    }

    Ok(normalized)
}

/// 出向 DLP 数据脱敏
pub fn sanitize_dlp(content: &str) -> String {
    let mut sanitized = content.to_string();
    for (re, rep) in get_dlp_patterns() {
        sanitized = re.replace_all(&sanitized, *rep).to_string();
    }
    sanitized
}

/// 8KB 与 150 行双重安全截断器
pub fn truncate_output(content: &str) -> (String, bool) {
    let max_lines = 150;
    let max_bytes = 8192;

    let lines: Vec<&str> = content.lines().collect();
    let mut truncated = false;
    let mut selected_text = if lines.len() > max_lines {
        truncated = true;
        let mut sliced = lines[..max_lines].join("\n");
        sliced.push_str(&format!(
            "\n\n--- [已截断：输出共 {} 行，已按安全配额仅读取前 {} 行] ---",
            lines.len(),
            max_lines
        ));
        sliced
    } else {
        content.to_string()
    };

    if selected_text.len() > max_bytes {
        truncated = true;
        // 安全截断到 UTF-8 字符边界
        let mut byte_limit = max_bytes.min(selected_text.len());
        while !selected_text.is_char_boundary(byte_limit) && byte_limit > 0 {
            byte_limit -= 1;
        }
        selected_text = selected_text[..byte_limit].to_string();
        selected_text.push_str("\n\n--- [已截断：输出超出 8192 字节，已自动截断防止外部上下文撑爆] ---");
    }

    (selected_text, truncated)
}
