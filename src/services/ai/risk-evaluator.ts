/**
 * src/services/ai/risk-evaluator.ts
 *
 * Qshell Shell 命令三级风险评级与毁灭性黑名单硬阻断引擎
 * 在前端端侧做静态分析，任何由 AI 生成或推荐的命令必须先过此安全护栏
 */

import type { CommandRiskAnalysis, CommandRiskLevel } from '@/types/ai'

// 绝对毁灭性黑名单：无论 AI 如何包装，一律硬阻断（isBlocked: true）
const HARD_BLOCK_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /rm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:\/\s*$|\/\*|\/\.\*)/,
    reason: '检测到针对系统根目录的强制递归删除操作 (rm -rf /)，永久硬阻断！',
  },
  {
    regex: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    reason: '检测到 Fork 炸弹代码，会耗尽系统进程表导致死机，永久硬阻断！',
  },
  {
    regex: />\s*\/dev\/sd[a-z0-9]/,
    reason: '检测到直接向物理磁盘裸设备重定向写入，会导致分区表与数据损毁，永久硬阻断！',
  },
  {
    regex: /dd\s+if=[^ \t\r\n]+\s+of=\/dev\/sd[a-z0-9]/,
    reason: '检测到使用 dd 直接覆写物理磁盘设备，永久硬阻断！',
  },
  {
    regex: /chmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+777\s+\/\s*$/,
    reason: '检测到全盘递归放开 777 权限，会彻底破坏 Linux 安全基线与 sudo 机制，永久硬阻断！',
  },
]

// 高危 / 破坏性操作 (Level 3: dangerous)
const DANGEROUS_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\brm\s+-[a-zA-Z]*r/, reason: '包含递归删除文件或目录 (rm -r)' },
  { regex: /\bmkfs(?:\.[a-z0-9]+)?\b/, reason: '格式化文件系统 (mkfs)' },
  { regex: /\bfdisk\b|\bparted\b/, reason: '磁盘分区操作' },
  { regex: /\bkill\s+-9\b|\bkillall\b|\bpkill\b/, reason: '强制终止进程 (kill -9 / killall)' },
  { regex: /\breboot\b|\bshutdown\b|\bpoweroff\b|\binit\s+0\b/, reason: '系统重启或关机操作' },
  { regex: /\biptables\s+-F\b|\bufw\s+reset\b/, reason: '清空全量防火墙策略，可能导致网络断连或暴露风险' },
  { regex: /curl\s+[^|\n]+\|\s*(?:ba)?sh\b|wget\s+[^|\n]+\|\s*(?:ba)?sh\b/, reason: '直接执行远程未经校验的脚本管道 (curl | bash)' },
]

// 中风险变更操作 (Level 2: notice)
const NOTICE_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  { regex: /\b(?:apt(?:-get)?|yum|dnf|pacman|apk)\s+(?:install|remove|purge|update|upgrade)\b/, reason: '包管理器软件安装或卸载' },
  { regex: /\bsystemctl\s+(?:restart|stop|reload|enable|disable)\b/, reason: '变更系统服务运行状态' },
  { regex: /\bdocker\s+(?:restart|stop|rm|rmi|kill)\b/, reason: '容器生命周期变更' },
  { regex: /\bchmod\b|\bchown\b/, reason: '修改文件或目录权限/所有者' },
  { regex: /\bmv\b|\bcp\b/, reason: '移动或复制文件' },
  { regex: /\bgit\s+(?:push|reset|clean|checkout)\b/, reason: '代码仓库版本或分支变更' },
]

/**
 * 分析单条或多条命令的安全风险
 */
export function evaluateCommandRisk(command: string): CommandRiskAnalysis {
  const trimmed = command?.trim() || ''
  if (!trimmed) {
    return {
      level: 'safe',
      command: '',
      reasons: [],
      isBlocked: false,
    }
  }

  // 1. 检查硬阻断黑名单
  for (const block of HARD_BLOCK_PATTERNS) {
    if (block.regex.test(trimmed)) {
      return {
        level: 'blocked',
        command: trimmed,
        reasons: [block.reason],
        isBlocked: true,
      }
    }
  }

  // 2. 检查高危/破坏性
  const dangerousReasons: string[] = []
  for (const item of DANGEROUS_PATTERNS) {
    if (item.regex.test(trimmed)) {
      dangerousReasons.push(item.reason)
    }
  }
  if (dangerousReasons.length > 0) {
    return {
      level: 'dangerous',
      command: trimmed,
      reasons: dangerousReasons,
      isBlocked: false,
    }
  }

  // 3. 检查中风险变更
  const noticeReasons: string[] = []
  for (const item of NOTICE_PATTERNS) {
    if (item.regex.test(trimmed)) {
      noticeReasons.push(item.reason)
    }
  }
  if (noticeReasons.length > 0) {
    return {
      level: 'notice',
      command: trimmed,
      reasons: noticeReasons,
      isBlocked: false,
    }
  }

  // 4. 默认只读查询 / 安全命令 (Level 1)
  return {
    level: 'safe',
    command: trimmed,
    reasons: ['安全命令或只读系统查询'],
    isBlocked: false,
  }
}
