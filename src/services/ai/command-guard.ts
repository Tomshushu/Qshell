/**
 * src/services/ai/command-guard.ts
 *
 * Qshell AI 终端安全指令决策网关 (Command Guard Engine - 零信任最后防线)
 *
 * 核心安全机制：
 * 1. 【严格只读白名单 (Strict Read-Only Whitelist)】：一票否决所有写、删、移动、重定向写入、杀死进程、重启服务与权限变更；
 * 2. 【防命令拼接与多指令绕过 (Command Chaining & Injection Shield)】：
 *    - 无论通过分号 `;`、逻辑与 `&&`、逻辑或 `||`、换行 `\n`、管道 `|` 拼接的每一段命令，均必须独立且完整通过只读审查；
 *    - 严厉阻断后台脱钩运行符 `&`（防止以异步守护进程脱离控制）；
 * 3. 【防子 Shell 嵌套注入 (Subshell Execution Guard)】：
 *    - 严厉阻断 `$()`、反引号 `` `...` ``、进程替换 `<()` / `>()` 等隐藏执行语法；
 * 4. 【防深度遍历与 I/O 阻塞 (Anti-Hang & DoS Prevention)】：
 *    - `du` 强制限定深度 (`--max-depth=1` 或 `-d 1`)，严禁裸跑 `du -sh /*` 导致磁盘 I/O 队列打满；
 *    - `find` 强制限定深度 (`-maxdepth 1~2`)，严禁全盘根目录遍历；
 *    - `find` 严厉阻断 `-exec`、`-execdir`、`-delete`、`-ok` 等执行与删除扩展；
 *    - `grep -r` 严禁直接针对根目录或全盘大目录递归；
 *    - 日志与长文本查询自动追加行数截断保护 (`head -n 150`)，避免前端撑爆；
 * 5. 【文件写重定向彻底拦截 (Redirection Strict Audit)】：
 *    - 仅允许重定向至 `/dev/null` 或标准文件描述符 `2>&1` / `1>&2`，一票否决任何写入真实文件或设备的重定向 (`>`、`>>`、`>|`、`1>`、`2>`、`&>`)；
 * 6. 【代码执行与数据外溢防御 (Interpreter & Exfiltration Defense)】：
 *    - `awk` 严厉阻断 `system()` 调用、管道执行与写入重定向；
 *    - `curl` 严格限定为 GET/HEAD 只读探测，严禁携带 `-d`、`-F`、`-X POST/PUT/DELETE` 或本地落盘保存；
 *    - 严厉阻断 `eval`、`exec`、`source` 及 `python -c`、`perl -e`、`bash -c` 等任意脚本即时执行；
 * 7. 【敏感路径硬拦截 (Sensitive Path Shield)】：
 *    - 严禁读取 `/etc/shadow`、`/etc/sudoers`、SSH 私钥 (`.ssh/id_*`)、Shell 历史日志 (`.bash_history`)、内核物理内存等；
 * 8. 【自定义黑白名单扩展 (Custom Blacklist)】：
 *    - 支持用户按需在前端注入业务级自定义违禁词。
 */

import type { CommandRiskLevel } from '@/types/ai'

export interface CommandGuardOptions {
  customBlacklist?: string[]
  customWhitelist?: string[]
  executionMode?: 'ask' | 'auto_readonly' | 'disabled'
}

export interface CommandGuardDecision {
  allowed: boolean
  isReadOnly: boolean
  riskLevel: CommandRiskLevel
  reason: string
  safeToAutoExecute: boolean
  isInteractive?: boolean
  blockedReason?: string
  suggestedSafeCommand?: string
}

/**
 * 终端常驻交互式与循环监控程序（禁止在后台单次非交互通道中采样运行以防挂起，引导用户在左侧终端运行）
 */
export const INTERACTIVE_TUI_COMMANDS = new Set([
  'watch',
  'htop',
  'iftop',
  'iotop',
  'nmon',
  'glances',
  'less',
  'more',
  'vi',
  'vim',
  'nano',
  'emacs',
])

/**
 * 允许执行的纯只读查询指令白名单（基础命令名称）
 */
const READONLY_COMMAND_WHITELIST = new Set([
  // 系统与内核指标
  'free',
  'uptime',
  'df',
  'vmstat',
  'iostat',
  'top',
  'mpstat',
  'lscpu',
  'lsmem',
  'uname',
  'hostname',
  'arch',
  'lsblk',
  'blkid',
  'dmesg',

  // 进程、端口、网络
  'ps',
  'ss',
  'netstat',
  'lsof',
  'ip',
  'ifconfig',
  'arp',
  'ping',
  'traceroute',
  'nslookup',
  'dig',
  'curl', // 仅限只读查询，且严格禁止包含 POST/-d/upload 及管道至 sh

  // 文本与文件只读查看
  'cat',
  'head',
  'tail',
  'grep',
  'egrep',
  'fgrep',
  'awk', // 严格禁止 system() 与重定向
  'cut',
  'sort',
  'uniq',
  'wc',
  'diff',
  'col',
  'more',
  'less',
  'ls',
  'dir',
  'tree',
  'file',
  'stat',
  'du', // 需严格校验 --max-depth
  'find', // 需严格校验 -maxdepth，严禁 -exec/-delete

  // 服务与容器只读状态
  'systemctl', // 仅限 status, is-active, is-failed, is-enabled, show
  'journalctl', // 仅限只读查看
  'docker', // 仅限 ps, logs, inspect, stats 等只读子命令
  'podman',
  'kubectl', // 仅限 get, describe, logs

  // 环境信息
  'env',
  'printenv',
  'whoami',
  'id',
  'date',
  'echo', // 仅限只读回显，严禁搭配 > 重定向
  'which',
  'whereis',
  'type',

  // Linux / Unix 扩展系统与发行版只读信息
  'hostnamectl',
  'timedatectl',
  'localectl',
  'resolvectl',
  'networkctl',
  'loginctl',
  'sysctl',
  'dpkg', // 限制为 -l, -s 等包查询
  'rpm', // 限制为 -qa, -q 等包查询
  'apk', // 限制为 info 包查询
  'ufw', // 限制为 status
  'firewall-cmd', // 限制为 --state, --list-all 等只读查看

  // macOS / Darwin / BSD 平台特有只读命令
  'sw_vers', // macOS 版本信息
  'vm_stat', // macOS 虚拟内存页统计
  'diskutil', // 限制仅 list, info
  'launchctl', // 限制仅 list, print
  'scutil', // macOS 网络与配置只读查询
  'defaults', // 仅限 read 只读偏好配置

  // Windows CMD & PowerShell 平台特有只读命令
  'ipconfig', // Windows IP 配置
  'systeminfo', // Windows 硬件与系统信息
  'tasklist', // Windows 任务进程列表
  'tracert', // Windows 路由跟踪
  'route', // 限制仅 print 查看路由表
  'driverquery', // Windows 驱动列表
  'get-process', // PowerShell 只读进程列表
  'gps',
  'get-service', // PowerShell 只读服务列表
  'gsv',
  'get-content', // PowerShell 只读文本内容
  'gc',
  'select-string', // PowerShell 文本过滤检索
  'sls',
  'get-childitem', // PowerShell 目录与文件列表
  'gci',
  'get-psdrive', // PowerShell 磁盘与驱动器只读
  'get-ciminstance', // PowerShell WMI/CIM 系统信息只读
  'get-wmiobject',
  'get-netipaddress', // PowerShell 网络配置与连接只读
  'get-nettcpconnection',
  'test-netconnection',
  'get-computerinfo',
  'format-table', // PowerShell 格式化与管道工具
  'format-list',
  'select-object',
  'where-object',
  'measure-object',
  'out-string',
])

/**
 * 绝对毁灭性 / 灾难性硬阻断正则
 */
const ABSOLUTE_BLOCKED_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /rm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:\/\s*$|\/\*|\/\.\*)/,
    reason: '检测到针对系统根目录的强制递归删除操作 (rm -rf /)，永久硬阻断！',
  },
  {
    regex: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    reason: '检测到 Fork 炸弹代码，会耗尽系统进程表导致死机，永久硬阻断！',
  },
  {
    regex: />\s*\/dev\/(?:sd[a-z0-9]|nvme[0-9]n[0-9]|vd[a-z0-9]|hd[a-z0-9])/,
    reason: '检测到直接向物理磁盘裸设备重定向写入，会导致分区表与数据损毁，永久硬阻断！',
  },
  {
    regex: /dd\s+(?:if=[^ \t\r\n]+\s+)?of=\/dev\/(?:sd[a-z0-9]|nvme[0-9]n[0-9]|vd[a-z0-9]|hd[a-z0-9]|null\b)/,
    reason: '检测到使用 dd 覆写物理磁盘设备，永久硬阻断！',
  },
  {
    regex: /chmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+777\s+\/\s*$/,
    reason: '检测到全盘递归放开 777 权限，永久硬阻断！',
  },
]

/**
 * 敏感凭证与机密路径保护 (禁止读取系统私钥、密码散列与凭据文件)
 */
const SENSITIVE_PATH_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\/etc\/shadow\b/, reason: '禁止读取 Linux 用户密码哈希表 (/etc/shadow)' },
  { regex: /\/etc\/gshadow\b/, reason: '禁止读取用户组凭证表 (/etc/gshadow)' },
  { regex: /\/etc\/master\.passwd\b/, reason: '禁止读取系统主密码表 (/etc/master.passwd)' },
  { regex: /\/etc\/sudoers(?:\.d)?\b/, reason: '禁止访问 sudo 权限特权文件 (/etc/sudoers)' },
  { regex: /\/etc\/security\/opasswd\b/, reason: '禁止访问旧密码策略凭据文件 (/etc/security/opasswd)' },
  {
    regex: /\.ssh\/(?:id_[a-zA-Z0-9_-]+|.*\.pem|.*\.key|.*\.priv|authorized_keys|known_hosts)\b/,
    reason: '禁止访问任何 SSH 密钥凭证文件 (~/.ssh/*)',
  },
  { regex: /\.(?:bash_history|zsh_history|sh_history|history)\b/, reason: '禁止读取终端命令历史记录，防止明文凭证泄露' },
  { regex: /\/proc\/(?:kcore|kmem)\b/, reason: '禁止访问 Linux 内核物理内存映射 (/proc/kcore)' },
  { regex: /\/dev\/(?:mem|kmem|port)\b/, reason: '禁止直接访问底层内存与硬件端口设备 (/dev/mem)' },
]

/**
 * 写操作与变更类操作阻断模式
 */
const MUTATION_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  // 管道写文件
  { regex: /\|\s*tee\b/, reason: '检测到管道写文件 (tee)，只读网关严禁写入！' },

  // 文件写、删、移
  { regex: /\brm\b/, reason: '检测到删除指令 (rm)，只读模式严格禁止删除！' },
  { regex: /\bmv\b/, reason: '检测到移动或重命名指令 (mv)，只读模式禁止移动！' },
  { regex: /\bcp\b/, reason: '检测到复制写入指令 (cp)，只读模式禁止写文件！' },
  { regex: /\btouch\b/, reason: '检测到新建文件指令 (touch)！' },
  { regex: /\bmkdir\b|\brmdir\b/, reason: '检测到目录创建或移除指令 (mkdir/rmdir)！' },
  { regex: /\btruncate\b/, reason: '检测到文件截断清空指令 (truncate)！' },
  { regex: /\bshred\b/, reason: '检测到文件粉碎指令 (shred)！' },

  // 原地修改文件
  { regex: /\bsed\s+-[a-zA-Z]*i/, reason: '检测到 sed 原地修改文件 (-i)，严禁修改配置！' },
  { regex: /\bsed\s+.*[0-9]*[a-zA-Z]*e\b/, reason: '检测到 sed 脚本执行模式，严禁执行！' },
  { regex: /\bperl\s+-[a-zA-Z]*i/, reason: '检测到 perl 原地修改文件 (-i)！' },

  // 杀死进程
  { regex: /\bkill\b|\bkillall\b|\bpkill\b|\bfuser\s+-[a-zA-Z]*k/, reason: '检测到终止进程操作 (kill/pkill)，只读模式禁止强杀进程！' },

  // 系统生命周期
  { regex: /\breboot\b|\bshutdown\b|\bpoweroff\b|\bhalt\b|\binit\s+[06]\b/, reason: '检测到重启或关机操作，严禁执行！' },

  // 服务状态变更
  {
    regex: /\bsystemctl\s+(?:restart|stop|reload|enable|disable|mask|unmask|revert)\b/,
    reason: '检测到修改系统服务运行状态 (systemctl restart/stop 等)，只读模式仅允许 status 查询！',
  },
  {
    regex: /\bservice\s+[a-zA-Z0-9._-]+\s+(?:restart|stop|reload|start)\b/,
    reason: '检测到使用 service 变更服务状态，只读模式仅允许 status 查询！',
  },

  // 容器状态变更
  {
    regex: /\bdocker\s+(?:restart|stop|kill|rm|rmi|prune|build|run|create|start|exec)\b/,
    reason: '检测到变更容器生命周期或交互式执行 (docker restart/stop/exec 等)，只读模式仅允许 ps/logs/inspect/stats！',
  },
  {
    regex: /\bpodman\s+(?:restart|stop|kill|rm|rmi|prune|build|run|create|start|exec)\b/,
    reason: '检测到变更容器状态，只读模式仅允许 ps/logs/inspect！',
  },

  // 权限与用户
  { regex: /\bchmod\b|\bchown\b|\bchgrp\b|\bsetfacl\b/, reason: '检测到修改文件权限或属主 (chmod/chown)！' },
  { regex: /\buseradd\b|\buserdel\b|\busermod\b|\bgroupadd\b/, reason: '检测到系统用户与组配置变更！' },

  // 网络与防火墙变更
  { regex: /\biptables\s+-[ADIFR]/, reason: '检测到修改 iptables 防火墙策略！' },
  { regex: /\bufw\s+(?:enable|disable|allow|deny|delete|reset)\b/, reason: '检测到修改 ufw 防火墙规则！' },
  { regex: /\bfirewall-cmd\s+--(?:add|remove)/, reason: '检测到修改 firewall-cmd 规则！' },

  // 软件包安装与卸载
  {
    regex: /\b(?:apt(?:-get)?|yum|dnf|pacman|apk)\s+(?:install|remove|purge|update|upgrade)\b/,
    reason: '检测到包管理器软件安装或卸载操作！',
  },
  {
    regex: /\b(?:npm|yarn|pnpm|pip|pip3|cargo)\s+(?:install|uninstall|update)\b/,
    reason: '检测到开发环境依赖安装或卸载操作！',
  },

  // 提权、远程脚本与动态代码执行
  { regex: /\bsudo\b|\bsu\s/, reason: '检测到使用 sudo/su 提权，只读网关禁止执行提权指令！' },
  { regex: /\|\s*(?:ba)?sh\b/, reason: '检测到管道直接执行 Shell 脚本 (如 curl | bash)，极高安全风险！' },
  { regex: /\b(?:eval|exec|source)\b/, reason: '检测到动态解释执行 (eval/exec/source)，严防逃逸！' },
  {
    regex: /\b(?:python|python3|perl|ruby|php|node|bash|sh|zsh)\s+-[ce]\b/,
    reason: '检测到使用脚本解释器直接执行代码 (-c/-e)，只读模式严禁执行任意代码！',
  },

  // Windows PowerShell 破坏性 Cmdlet 拦截
  {
    regex: /\b(?:Remove-Item|rmdir|rd|del|erase|Stop-Process|Stop-Service|Restart-Service|Restart-Computer|Stop-Computer|Format-Volume|Set-Content|Add-Content|Out-File|Clear-Content|Invoke-Expression|iex)\b/i,
    reason: '检测到 PowerShell 文件修改、进程强杀或关机指令，只读模式严格禁止！',
  },

  // 交互式程序（会挂死非交互执行通道）
  { regex: /\b(?:vim?|nano|emacs|gdb|htop|glances)\b/, reason: '检测到交互式全屏终端程序，非交互通道执行会导致进程挂起！' },
]

/**
 * 严格审查重定向操作：在只读安全网关中，仅允许重定向到 /dev/null 或 2>&1，
 * 任何写入实际文件或设备的重定向一律硬拦截。
 */
function checkRedirectionSafety(command: string): { safe: boolean; reason?: string } {
  // 1. 过滤掉安全的文件描述符重定向与 /dev/null 丢弃重定向
  // 安全重定向范式：2>&1, 1>&2, > /dev/null, 1> /dev/null, 2> /dev/null, &> /dev/null, >> /dev/null, 2>/dev/null
  const sanitized = command
    .replace(/2>&1/g, ' ')
    .replace(/1>&2/g, ' ')
    .replace(/(?:>>|>|1>|2>|&>|>\|)\s*\/dev\/null\b/g, ' ')

  // 2. 如果剩余部分中仍然包含重定向写入符（>），说明企图向非 null 目标写入文件
  if (/>/.test(sanitized)) {
    return {
      safe: false,
      reason: '检测到文件写重定向操作 (>)，只读安全网关严格禁止修改或覆写任何服务器文件！',
    }
  }

  return { safe: true }
}

/**
 * 审查单个命令片段是否符合安全规范
 */
function evaluateSingleCommandSegment(segment: string): {
  allowed: boolean
  isInteractive?: boolean
  blockedReason?: string
  suggestedSafeCommand?: string
} {
  const trimmed = segment.trim()
  if (!trimmed) return { allowed: false, blockedReason: '命令片段为空' }

  // 提取命令名（跳过环境变量前缀如 `VAR=1 cmd`，并过滤掉引号与反斜杠）
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  let cmdIndex = 0
  while (cmdIndex < tokens.length && tokens[cmdIndex].includes('=')) {
    cmdIndex++
  }

  const rawToken = tokens[cmdIndex] || ''
  const baseCmd = rawToken.toLowerCase().replace(/['"\\]/g, '').replace(/^[\w/-]+\//, '')

  if (!baseCmd) {
    return { allowed: false, blockedReason: '无法识别有效命令名' }
  }

  // 0. 优先识别交互式常驻程序（如 watch, htop, tail -f 等）
  if (INTERACTIVE_TUI_COMMANDS.has(baseCmd) || /tail\s+-[a-zA-Z]*[fF]/i.test(trimmed)) {
    return {
      allowed: false,
      isInteractive: true,
      blockedReason: `命令「${baseCmd}」为常驻交互式程序，需在终端窗口中持续交互运行，无法在后台单次非交互通道中采样运行。建议直接在左侧终端窗口中运行。`,
    }
  }

  // 1. 白名单基础校验
  if (!READONLY_COMMAND_WHITELIST.has(baseCmd)) {
    return {
      allowed: false,
      blockedReason: `命令「${baseCmd}」不在允许执行的只读白名单中，已被安全网关拒绝。`,
    }
  }

  // 2. 特殊指令深度防护：du
  if (baseCmd === 'du') {
    const hasDepthLimit = /--max-depth=\d+|-d\s*\d+/.test(trimmed)
    if (!hasDepthLimit) {
      return {
        allowed: false,
        blockedReason: '【防卡死拦截】du 指令未限定递归深度，全盘计算容易导致磁盘 I/O 堵塞卡死！',
        suggestedSafeCommand: 'du -h --max-depth=1',
      }
    }
    // 检查是否裸盘根目录扫描
    if (/du\s+-[a-zA-Z]*\s+\/\*?\s*$/.test(trimmed)) {
      return {
        allowed: false,
        blockedReason: '【防卡死拦截】严禁在系统根目录裸跑全盘 du，请指定具体排查子目录（如 /var/log）。',
      }
    }
  }

  // 3. 特殊指令深度与安全防护：find
  if (baseCmd === 'find') {
    // 3.1 阻断 -delete, -exec, -execdir, -ok
    if (/-(?:exec|execdir|delete|ok|okdir)\b/.test(trimmed)) {
      return {
        allowed: false,
        blockedReason: '【高危阻断】find 指令严禁携带 -exec、-delete 等执行或删除参数！',
      }
    }

    // 3.2 深度限制校验
    const hasDepthLimit = /-maxdepth\s+[12]\b/.test(trimmed)
    if (!hasDepthLimit) {
      return {
        allowed: false,
        blockedReason: '【防卡死拦截】find 指令必须包含深度限制 (-maxdepth 1 或 2)，防止无界全盘遍历卡死主机！',
        suggestedSafeCommand: 'find . -maxdepth 1',
      }
    }
    // 检查是否根目录无界搜索
    if (/find\s+\/\s/.test(trimmed) && !/-maxdepth\s+1\b/.test(trimmed)) {
      return {
        allowed: false,
        blockedReason: '【防卡死拦截】从根目录「/」检索深度过大，已自动拦截。',
      }
    }
  }

  // 4. 特殊指令防护：grep -r
  if (baseCmd === 'grep' || baseCmd === 'egrep') {
    if (/-[a-zA-Z]*r/.test(trimmed) && /\s+(?:\/|\/var|\/usr|\/etc)\s*$/.test(trimmed)) {
      return {
        allowed: false,
        blockedReason: '【防卡死拦截】严禁对系统大目录进行全盘递归 grep，请指定具体日志文件。',
      }
    }
  }

  // 5. 特殊指令防护：awk 任意命令执行与写入防护
  if (baseCmd === 'awk') {
    if (/\bsystem\s*\(|\|\s*["']?(?:ba)?sh|getline\s+.*<|print\s+.*>/.test(trimmed)) {
      return {
        allowed: false,
        blockedReason: '【高危阻断】awk 指令包含 system() 调用、命令管道或文件写入，已被安全网关硬阻断！',
      }
    }
  }

  // 6. 特殊指令防护：curl 限制为只读探测，禁止数据外溢与本地落盘
  if (baseCmd === 'curl') {
    if (
      /-X\s*(?:POST|PUT|DELETE|PATCH)\b|-d\b|--data\b|--data-|-F\b|--form\b|-T\b|--upload-file\b|-o\b|--output\b|-O\b|--remote-name\b/i.test(
        trimmed,
      )
    ) {
      return {
        allowed: false,
        blockedReason: '【外溢/写入阻断】curl 仅允许发起只读请求，严禁发送 POST/PUT 请求、表单提交或保存到文件！',
      }
    }
  }

  // 7. 特殊指令防护：systemctl
  if (baseCmd === 'systemctl') {
    const subCmd = tokens[cmdIndex + 1]?.toLowerCase()
    const allowedSub = ['status', 'is-active', 'is-failed', 'is-enabled', 'show', 'list-units']
    if (!subCmd || !allowedSub.includes(subCmd)) {
      return {
        allowed: false,
        blockedReason: `systemctl 仅允许执行只读查看 (${allowedSub.join('/')})，禁止变更服务！`,
      }
    }
  }

  // 8. 特殊指令防护：docker
  if (baseCmd === 'docker') {
    const subCmd = tokens[cmdIndex + 1]?.toLowerCase()
    const allowedSub = ['ps', 'logs', 'inspect', 'stats', 'version', 'info', 'images', 'top']
    if (!subCmd || !allowedSub.includes(subCmd)) {
      return {
        allowed: false,
        blockedReason: `docker 仅允许只读查看 (ps/logs/inspect/stats)，严禁重启、创建或删除容器！`,
      }
    }
  }

  // 9. 特殊指令防护：diskutil (macOS)
  if (baseCmd === 'diskutil') {
    const subCmd = tokens[cmdIndex + 1]?.toLowerCase()
    const allowedSub = ['list', 'info']
    if (!subCmd || !allowedSub.includes(subCmd)) {
      return {
        allowed: false,
        blockedReason: `diskutil 仅允许只读查看 (${allowedSub.join('/')})，严禁擦除、分区或修改磁盘！`,
      }
    }
  }

  // 10. 特殊指令防护：launchctl (macOS)
  if (baseCmd === 'launchctl') {
    const subCmd = tokens[cmdIndex + 1]?.toLowerCase()
    const allowedSub = ['list', 'print']
    if (!subCmd || !allowedSub.includes(subCmd)) {
      return {
        allowed: false,
        blockedReason: `launchctl 仅允许只读查看 (list/print)，严禁启动或卸载服务！`,
      }
    }
  }

  // 11. 特殊指令防护：dpkg / rpm (包查询)
  if (baseCmd === 'dpkg') {
    if (!trimmed.includes('-l') && !trimmed.includes('--list') && !trimmed.includes('-s') && !trimmed.includes('-S')) {
      return {
        allowed: false,
        blockedReason: 'dpkg 仅允许使用 -l/--list/-s 进行包状态只读查询，严禁安装或卸载软件包！',
      }
    }
  }
  if (baseCmd === 'rpm') {
    if (!trimmed.includes('-q') && !trimmed.includes('-qa') && !trimmed.includes('-qi')) {
      return {
        allowed: false,
        blockedReason: 'rpm 仅允许使用 -q/-qa/-qi 查询已安装包，严禁安装或卸载软件包！',
      }
    }
  }

  // 12. 特殊指令防护：ufw / firewall-cmd
  if (baseCmd === 'ufw') {
    const subCmd = tokens[cmdIndex + 1]?.toLowerCase()
    if (subCmd !== 'status') {
      return {
        allowed: false,
        blockedReason: 'ufw 仅允许只读查看 status，严禁修改防火墙规则！',
      }
    }
  }
  if (baseCmd === 'firewall-cmd') {
    if (trimmed.includes('--add') || trimmed.includes('--remove') || trimmed.includes('--reload')) {
      return {
        allowed: false,
        blockedReason: 'firewall-cmd 仅允许查看状态，严禁修改规则！',
      }
    }
  }

  // 13. 特殊指令防护：route
  if (baseCmd === 'route') {
    if (!trimmed.includes('print') && !trimmed.includes('-n')) {
      return {
        allowed: false,
        blockedReason: 'route 仅允许 print 或 -n 查看路由表，严禁添加或删除路由条目！',
      }
    }
  }

  return { allowed: true }
}

/**
 * 完整指令多重安全评估与网关决策（最后一道防线）
 */
export function evaluateCommandForExecution(
  command: string,
  options: CommandGuardOptions = {},
): CommandGuardDecision {
  const trimmed = command?.trim() || ''

  if (!trimmed) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'safe',
      reason: '命令为空',
      safeToAutoExecute: false,
    }
  }

  // 0. 模式开关检查：若完全禁用执行
  if (options.executionMode === 'disabled') {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'blocked',
      reason: '已在设置中关闭 AI 终端指令执行功能',
      safeToAutoExecute: false,
      blockedReason: '当前系统已配置为「完全禁止执行」，AI 指令仅供参考。',
    }
  }

  // 1. 自定义黑名单校验
  if (options.customBlacklist && options.customBlacklist.length > 0) {
    for (const item of options.customBlacklist) {
      const cleanItem = item.trim().toLowerCase()
      if (cleanItem && trimmed.toLowerCase().includes(cleanItem)) {
        return {
          allowed: false,
          isReadOnly: false,
          riskLevel: 'blocked',
          reason: `命中用户自定义安全黑名单: "${cleanItem}"`,
          safeToAutoExecute: false,
          blockedReason: `命中您自定义安全黑名单关键词「${cleanItem}」，已坚决阻断！`,
        }
      }
    }
  }

  // 2. 绝对毁灭性黑名单校验
  for (const item of ABSOLUTE_BLOCKED_PATTERNS) {
    if (item.regex.test(trimmed)) {
      return {
        allowed: false,
        isReadOnly: false,
        riskLevel: 'blocked',
        reason: item.reason,
        safeToAutoExecute: false,
        blockedReason: item.reason,
      }
    }
  }

  // 3. 敏感路径访问防护 (凭证、Shadow、SSH 私钥、历史记录、内核内存)
  for (const item of SENSITIVE_PATH_PATTERNS) {
    if (item.regex.test(trimmed)) {
      return {
        allowed: false,
        isReadOnly: false,
        riskLevel: 'blocked',
        reason: item.reason,
        safeToAutoExecute: false,
        blockedReason: item.reason,
      }
    }
  }

  // 4. 子 Shell 嵌套注入硬防护 (防反引号 `` 与 $() 提权/命令替换)
  if (/\$\(/.test(trimmed)) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'blocked',
      reason: '检测到 $() 子 Shell 命令替换，只读网关严格禁止嵌套指令执行！',
      safeToAutoExecute: false,
      blockedReason: '检测到 $() 子 Shell 命令替换，严禁执行嵌套隐藏指令！',
    }
  }
  if (/`[^`]+`/.test(trimmed)) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'blocked',
      reason: '检测到反引号 `` 子 Shell 命令替换，只读网关严格禁止嵌套指令执行！',
      safeToAutoExecute: false,
      blockedReason: '检测到反引号 `` 子 Shell 命令替换，严禁执行嵌套隐藏指令！',
    }
  }
  if (/<\(|>\(/.test(trimmed)) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'blocked',
      reason: '检测到进程替换语法 <() / >()，已自动阻断！',
      safeToAutoExecute: false,
      blockedReason: '检测到进程替换语法，严禁执行！',
    }
  }

  // 5. 后台异步执行符阻断 (&，排除合法重定向 2>&1)
  const withoutSafeAmp = trimmed.replace(/(?:2|1)?&[0-9]/g, ' ').replace(/&&/g, ' ')
  if (/(?<!\w)&(?!\w)/.test(withoutSafeAmp)) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'blocked',
      reason: '检测到后台脱钩运行符 (&)，只读检查禁止以后台脱钩模式运行！',
      safeToAutoExecute: false,
      blockedReason: '禁止在后台运行异步命令！',
    }
  }

  // 6. 重定向严格审计：只允许写向 /dev/null 或标准文件描述符
  const redirCheck = checkRedirectionSafety(trimmed)
  if (!redirCheck.safe) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'dangerous',
      reason: redirCheck.reason || '检测到写重定向操作',
      safeToAutoExecute: false,
      blockedReason: redirCheck.reason,
    }
  }

  // 7. 写操作与破坏性全局正则检查
  for (const item of MUTATION_PATTERNS) {
    if (item.regex.test(trimmed)) {
      return {
        allowed: false,
        isReadOnly: false,
        riskLevel: 'dangerous',
        reason: item.reason,
        safeToAutoExecute: false,
        blockedReason: item.reason,
      }
    }
  }

  // 8. 多指令全链切分全量审查 (全面分解 ; / && / || / | / \n)
  // 杜绝前指令为白名单而用分号或逻辑符拼接破坏性指令的绕过手段
  const segments = trimmed
    .split(/(?:&&|\|\||[;|\r\n]+)/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    return {
      allowed: false,
      isReadOnly: false,
      riskLevel: 'safe',
      reason: '无有效命令片段',
      safeToAutoExecute: false,
    }
  }

  for (const seg of segments) {
    const segDecision = evaluateSingleCommandSegment(seg)
    if (!segDecision.allowed) {
      return {
        allowed: false,
        isReadOnly: false,
        riskLevel: 'notice',
        isInteractive: Boolean(segDecision.isInteractive),
        reason: segDecision.blockedReason || '命令链中包含未允许的操作',
        safeToAutoExecute: false,
        blockedReason: segDecision.blockedReason,
        suggestedSafeCommand: segDecision.suggestedSafeCommand,
      }
    }
  }

  // 9. 全项安全校验通过
  const isAuto = options.executionMode === 'auto_readonly'

  return {
    allowed: true,
    isReadOnly: true,
    riskLevel: 'safe',
    reason: '经过严格只读白名单、防子Shell注入、防拼接绕过及深度卡死校验，无写操作风险。',
    safeToAutoExecute: isAuto,
  }
}

/**
 * 包装安全只读查询指令（自动限制输出行数与超时，防止撑爆终端与内存）
 */
export function wrapSafeInspectionCommand(command: string, maxLines = 150): string {
  const trimmed = command.trim()
  if (!trimmed) return ''

  // 若已有 head 或 tail 截断，则无需重复添加
  if (/\|\s*(?:head|tail)\b/.test(trimmed)) {
    return trimmed
  }

  // 针对 cat / grep / journalctl 等大输出命令，自动追加行数截断保护
  if (/^(?:cat|grep|egrep|journalctl|dmesg|docker\s+logs)\b/.test(trimmed)) {
    return `${trimmed} | head -n ${maxLines}`
  }

  return trimmed
}

/**
 * 根据执行的 Shell 指令与其真实的终端标准输出，智能提炼结构化分析结论
 */
export function generateExecutionSummary(command: string, output: string): string {
  if (!output || !output.trim()) {
    return '指令已成功执行，终端退出码为 0，无异常报错输出。'
  }

  const trimmed = output.trim()
  const lowerCmd = command.toLowerCase()

  // 1. ps / 进程高占用排查命令 (ps aux, ps -eo 等)
  if (lowerCmd.includes('ps') && (lowerCmd.includes('mem') || lowerCmd.includes('cpu') || lowerCmd.includes('sort'))) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('USER') && !l.startsWith('PID'))
    if (lines.length > 0) {
      const topProcessLine = lines[0]
      const parts = topProcessLine.split(/\s+/)
      if (parts.length >= 4) {
        // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND...
        const pid = parts[1]
        const cpu = parts[2]
        const mem = parts[3]
        const cmdName = parts.slice(10).join(' ') || parts[parts.length - 1]
        // 提取友好的应用名
        let friendlyName = cmdName
        if (friendlyName.includes('/')) {
          const segments = friendlyName.split('/')
          friendlyName = segments[segments.length - 1] || friendlyName
        }
        if (cmdName.includes('java')) {
          friendlyName = 'Java 业务应用'
        } else if (cmdName.includes('emqx')) {
          friendlyName = 'EMQX 消息服务'
        } else if (cmdName.includes('mysqld') || cmdName.includes('mariadb')) {
          friendlyName = 'MySQL 数据库'
        } else if (cmdName.includes('redis')) {
          friendlyName = 'Redis 缓存'
        } else if (cmdName.includes('nginx')) {
          friendlyName = 'Nginx Web服务器'
        }

        const isMemQuery = lowerCmd.includes('mem')
        const metricStr = isMemQuery ? `内存占比: ${mem}% (CPU: ${cpu}%)` : `CPU占比: ${cpu}% (内存: ${mem}%)`
        return `当前资源占用最高的是【${friendlyName}】(PID: ${pid}，${metricStr})。采样列表中前 ${Math.min(lines.length, 5)} 个核心进程已呈现于输出区。`
      }
    }
  }

  // 2. df 磁盘挂载状态
  if (lowerCmd.includes('df')) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Filesystem') && !l.startsWith('文件系统'))
    let maxPct = 0
    let maxMount = ''
    for (const line of lines) {
      const match = line.match(/(\d+)%\s+([^\s]+)$/)
      if (match) {
        const pct = parseInt(match[1], 10)
        if (pct > maxPct) {
          maxPct = pct
          maxMount = match[2]
        }
      }
    }
    if (maxMount) {
      const statusText = maxPct >= 90 ? '🔴 严重告警' : maxPct >= 80 ? '🟡 需注意' : '🟢 空间健康'
      return `磁盘挂载采样完成：${statusText}。当前空间占用最高的挂载点为【${maxMount}】(已使用: ${maxPct}%)。`
    }
  }

  // 3. docker / podman 容器状态
  if (lowerCmd.includes('docker ps') || lowerCmd.includes('podman ps')) {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('CONTAINER') && !l.startsWith('IMAGE'))
    if (lines.length === 0 || trimmed.includes('未检测到')) {
      return '当前宿主机未检测到运行中的 Docker/Podman 容器。'
    }
    return `当前共检测到 ${lines.length} 个运行中的容器实例，全部处于 Up 活跃状态。`
  }

  // 4. free 内存状态
  if (lowerCmd.includes('free')) {
    const memMatch = trimmed.match(/Mem:\s+(\d+)\s+(\d+)\s+(\d+)/)
    if (memMatch) {
      const total = parseInt(memMatch[1], 10)
      const used = parseInt(memMatch[2], 10)
      const pct = ((used / total) * 100).toFixed(1)
      return `物理内存采样完成：总计约 ${Math.round(total / 1024)}GB，已使用 ${Math.round(used / 1024)}GB (使用率: ${pct}%)。`
    }
  }

  // 5. systemctl / service 状态
  if (lowerCmd.includes('systemctl') || lowerCmd.includes('service')) {
    if (trimmed.includes('active (running)')) {
      return '目标系统服务运行状态健康：active (running)。'
    }
    if (trimmed.includes('inactive (dead)')) {
      return '目标系统服务当前处于停止态：inactive (dead)。'
    }
    if (trimmed.includes('failed')) {
      return '⚠️ 目标系统服务存在异常或已崩溃失败：failed。'
    }
  }

  // 6. 兜底提取首行前缀
  const firstLine = trimmed.split('\n').filter(Boolean)[0] || ''
  const displayLine = firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine
  return `指令采样已顺利完成：${displayLine}`
}

