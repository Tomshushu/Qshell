/**
 * src/lib/command-intelligence/markov-chain.ts
 *
 * Qshell 本地高频命令马尔可夫链转移概率模型 (Markov Chain Transition Model)
 *
 * 核心特性：
 * 1. 0ms 本地计算，零云端 Token 成本，断网/离线机房 100% 可用
 * 2. 内置工程高频连招拓扑 (Git / Docker / Systemd / npm / Linux 常用命令链)
 * 3. 动态智能参数槽位抽取与回填 (Slot Extraction & Propagation，如 mkdir 后预测 cd 目标路径)
 * 4. 结合 OSC-7 提取的实时工作目录 (CWD) 进行场景化加权
 * 5. 本地在线学习机制 (Online Self-Learning & Recency Decay)，越用越准
 */

import type { HintItem, Platform } from './types'
import { getCachedDirEntryNames } from './remote-path-completion'

export interface MarkovPrediction {
  /** 预测的完整命令行 */
  command: string
  /** 转移置信度得分 (0.0 ~ 1.0) */
  confidence: number
  /** 触发原因说明（用于 UI 辅助展示） */
  reason: string
  /** 来源：'builtin'（内置连招先验）、'learned'（个人行为自主学习）或 'diagnostic'（终端报错智能修复） */
  source: 'builtin' | 'learned' | 'diagnostic'
  /** 关联前置动作标记 */
  actionTag?: string
}

export interface TransitionRecord {
  from: string
  to: string
  count: number
  lastUsed: number
  cwd?: string
}

/** 本地持久化 Key */
const MARKOV_STORAGE_KEY = 'qshell:markov-transitions-v1'
const MAX_LEARNED_TRANSITIONS = 600

// 内存缓存
let transitionsCache: TransitionRecord[] | null = null
// 预测候选缓存：候选集合只由 prevCommand + cwd 决定，输入前缀仅做最后过滤，
// 缓存「已排序的完整候选」可避免每次按键重复遍历 learned(≤600) + builtin 规则。
let predictionCache: { key: string; candidates: MarkovPrediction[] } | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === MARKOV_STORAGE_KEY) {
      transitionsCache = null
    }
  })
}

function loadLearnedTransitions(): TransitionRecord[] {
  if (transitionsCache) return transitionsCache
  try {
    const raw = localStorage.getItem(MARKOV_STORAGE_KEY)
    if (!raw) {
      transitionsCache = []
      return transitionsCache
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      transitionsCache = parsed.filter(
        (t) => t && typeof t.from === 'string' && typeof t.to === 'string' && typeof t.count === 'number',
      )
      return transitionsCache
    }
  } catch {
    /* ignore storage read error */
  }
  transitionsCache = []
  return transitionsCache
}

function saveLearnedTransitions(entries: TransitionRecord[]): void {
  transitionsCache = entries
  try {
    localStorage.setItem(MARKOV_STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* ignore storage write error */
  }
}

/**
 * 规范化命令（去除前导 sudo、环境变量定义及多余空格，提取核心行为模式）
 */
export function normalizeCommandPattern(cmd: string): { base: string; raw: string; args: string[] } {
  const raw = (cmd || '').trim()
  if (!raw) return { base: '', raw: '', args: [] }

  // 去除前导 sudo
  const withoutSudo = raw.replace(/^sudo\s+/, '')
  const parts = withoutSudo.split(/\s+/).filter(Boolean)
  const base = parts.slice(0, 2).join(' ').toLowerCase()
  return { base, raw: withoutSudo, args: parts.slice(1) }
}

/** 抽取出的命令实体槽位集合 */
export interface ExtractedSlots {
  targetPath?: string
  targetService?: string
  targetBranch?: string
  targetContainer?: string
  extractedDir?: string
  targetFile?: string
  targetPort?: string
}

/** 会话级最近实体记忆（允许跨 1~5 条中间命令依然记住最近操作过的服务/容器/文件/分支） */
interface SessionEntityState extends ExtractedSlots {
  updatedAt: number
}

const SESSION_ENTITY_TTL_MS = 10 * 60 * 1000
const sessionEntityMemory = new Map<string, SessionEntityState>()

/**
 * 槽位参数提取器（Slot Extractor）
 */
export function extractSlotsFromCommand(cmd: string): ExtractedSlots {
  const raw = cmd.trim().replace(/^sudo\s+/, '')
  const result: ExtractedSlots = {}

  // 1. mkdir -> 提取目录路径（支持双引号、单引号与普通无空格路径）
  const quotedMatch = raw.match(/^mkdir(?:\s+-[a-zA-Z]+)*\s+(['"])(.+?)\1(?:\s+.*)?$/i)
  if (quotedMatch?.[2]) {
    result.targetPath = quotedMatch[2]
  } else {
    const unquotedMatch = raw.match(/^mkdir(?:\s+-[a-zA-Z]+)*\s+(\S+)(?:\s+.*)?$/i)
    if (unquotedMatch?.[1]) {
      result.targetPath = unquotedMatch[1].replace(/^['"]|['"]$/g, '')
    }
  }

  // 2. 解压归档 (tar / unzip) 或 git clone -> 提取解压/克隆后的目录名
  const tarMatch = raw.match(/tar\s+-[a-zA-Z]*x[a-zA-Z]*\s+(?:-f\s+)?(['"]?)(.+?)\1(?:\s|$)/i)
  const unzipMatch = raw.match(/unzip\s+(?:-[a-zA-Z]+\s+)*(['"]?)(.+?)\1(?:\s|$)/i)
  const archivePath = tarMatch?.[2] || unzipMatch?.[2]
  if (archivePath) {
    const filename = archivePath.split(/[/\\]/).pop() || ''
    // 去除 .tar.gz, .tgz, .tar.bz2, .tar.xz, .tar, .zip
    const cleanDir = filename.replace(/\.(tar\.(gz|bz2|xz|zst)|tgz|zip|tar)$/i, '')
    if (cleanDir && cleanDir !== filename) {
      result.extractedDir = cleanDir
    }
  }
  const cloneMatch = raw.match(/^git\s+clone\s+(?:-\S+\s+)*(\S+)(?:\s+(\S+))?/i)
  if (cloneMatch?.[1]) {
    if (cloneMatch[2] && !cloneMatch[2].startsWith('-')) {
      result.extractedDir = cloneMatch[2].replace(/^['"]|['"]$/g, '')
    } else {
      const repoPart = cloneMatch[1].replace(/^['"]|['"]$/g, '').replace(/\/+$/, '').split(/[/:]/).pop() || ''
      const repoDir = repoPart.replace(/\.git$/i, '')
      if (repoDir) result.extractedDir = repoDir
    }
  }

  // 3. systemctl / journalctl -> 提取服务名
  const sysMatch = raw.match(/systemctl\s+(?:start|stop|restart|reload|status|enable|disable)\s+([a-zA-Z0-9_\-@.]+)/i)
  const journalMatch = raw.match(/journalctl\s+(?:-\S+\s+)*-u\s+([a-zA-Z0-9_\-@.]+)/i)
  if (sysMatch?.[1]) {
    result.targetService = sysMatch[1]
  } else if (journalMatch?.[1]) {
    result.targetService = journalMatch[1]
  }

  // 4. git checkout [-b] / git switch [-c] -> 提取分支名
  const branchMatch = raw.match(/git\s+(?:checkout(?:\s+-b)?|switch(?:\s+-c)?)\s+([a-zA-Z0-9_\-./]+)/i)
  if (branchMatch?.[1] && !branchMatch[1].startsWith('-')) {
    result.targetBranch = branchMatch[1]
  }

  // 5. docker -> 提取容器名或镜像
  const dockerRunMatch = raw.match(/docker\s+(?:logs|exec|stop|start|restart|rm|inspect|top)\s+(?:-[a-zA-Z]+\s+)*([a-zA-Z0-9_\-.]+)/i)
  if (dockerRunMatch?.[1]) {
    result.targetContainer = dockerRunMatch[1]
  }

  // 6. 文件编辑/查看 (vim / nano / cat / chmod / touch) -> 提取最近操作文件
  const fileMatch = raw.match(/^(?:vim|vi|nano|cat|less|tail|head|touch)\s+(?:-\S+\s+)*(['"]?)([^\s'"]+)\1$/i)
  if (fileMatch?.[2] && !fileMatch[2].startsWith('-')) {
    result.targetFile = fileMatch[2]
  }

  // 7. 端口排查 (lsof -i :8080 / ss / ufw) -> 提取最近关注端口
  const portMatch = raw.match(/(?:-i\s*:|\bport\s+|:\s*)(\d{2,5})\b/i)
  if (portMatch?.[1]) {
    result.targetPort = portMatch[1]
  }

  return result
}

/**
 * 更新指定会话/主机的最近实体记忆池
 */
export function updateSessionEntities(cmd: string, scopeId = 'default'): ExtractedSlots {
  const extracted = extractSlotsFromCommand(cmd)
  const hasAny = Object.values(extracted).some(Boolean)
  if (!hasAny) return getSessionEntities(scopeId)

  const prev = sessionEntityMemory.get(scopeId)
  const now = Date.now()
  const base: ExtractedSlots =
    prev && now - prev.updatedAt < SESSION_ENTITY_TTL_MS ? prev : {}
  const merged: SessionEntityState = {
    ...base,
    ...Object.fromEntries(Object.entries(extracted).filter(([, v]) => Boolean(v))),
    updatedAt: now,
  }
  sessionEntityMemory.set(scopeId, merged)
  return merged
}

/**
 * 读取指定会话/主机未过期的最近实体记忆
 */
export function getSessionEntities(scopeId = 'default'): ExtractedSlots {
  const state = sessionEntityMemory.get(scopeId)
  if (!state) return {}
  if (Date.now() - state.updatedAt > SESSION_ENTITY_TTL_MS) {
    sessionEntityMemory.delete(scopeId)
    return {}
  }
  return state
}

/**
 * 利用会话最近操作过的实体（服务名、容器名、分支名、文件名）对动态/路径补全候选进行智能置顶。
 */
export function boostHintsWithRecentEntities(
  items: HintItem[],
  commandChain: string[],
  scopeId = 'default',
): HintItem[] {
  if (items.length <= 1) return items
  const entities = getSessionEntities(scopeId)
  const recentTargets = new Set<string>()

  const rootCmd = commandChain[0]
  if (rootCmd === 'systemctl' || rootCmd === 'journalctl' || rootCmd === 'service') {
    if (entities.targetService) {
      recentTargets.add(entities.targetService)
      recentTargets.add(entities.targetService.replace(/\.service$/, ''))
      if (!entities.targetService.endsWith('.service')) {
        recentTargets.add(`${entities.targetService}.service`)
      }
    }
  } else if (rootCmd === 'docker') {
    if (entities.targetContainer) recentTargets.add(entities.targetContainer)
  } else if (rootCmd === 'git') {
    if (entities.targetBranch) recentTargets.add(entities.targetBranch)
  } else if (entities.targetFile) {
    recentTargets.add(entities.targetFile)
  }

  if (recentTargets.size === 0) return items

  const boosted: HintItem[] = []
  const rest: HintItem[] = []
  for (const item of items) {
    if (recentTargets.has(item.label) || recentTargets.has(item.insertText)) {
      boosted.push({
        ...item,
        badge: item.badge ?? '最近操作',
        desc: item.desc ? `最近操作 · ${item.desc}` : '最近操作',
      })
    } else {
      rest.push(item)
    }
  }
  return boosted.length > 0 ? [...boosted, ...rest] : items
}

/**
 * 内置通用工程连招先验拓扑定义 (Curated Workflow Priors)
 */
interface PriorRule {
  pattern: RegExp | string
  transitions: Array<{
    template: (slots: ReturnType<typeof extractSlotsFromCommand>, rawCmd: string) => string | string[]
    confidence: number
    reason: string
  }>
}

const BUILTIN_WORKFLOW_PRIORS: PriorRule[] = [
  // Git 工作流
  {
    pattern: /^git\s+status/i,
    transitions: [
      { template: () => 'git add .', confidence: 0.92, reason: '连招推荐 · 代码暂存' },
      { template: () => 'git diff', confidence: 0.78, reason: '连招推荐 · 查看变更' },
      { template: () => 'git pull', confidence: 0.72, reason: '连招推荐 · 拉取远端更新' },
    ],
  },
  {
    pattern: /^git\s+add(\s+.*)?$/i,
    transitions: [
      { template: () => 'git commit -m ""', confidence: 0.96, reason: '连招推荐 · 提交暂存' },
      { template: () => 'git status', confidence: 0.85, reason: '连招推荐 · 确认暂存状态' },
      { template: () => 'git diff --cached', confidence: 0.75, reason: '连招推荐 · 检查暂存差异' },
    ],
  },
  {
    pattern: /^git\s+commit/i,
    transitions: [
      { template: () => 'git push', confidence: 0.94, reason: '连招推荐 · 推送到远端' },
      { template: () => 'git log -n 5', confidence: 0.76, reason: '连招推荐 · 检查提交历史' },
      { template: () => 'git status', confidence: 0.7, reason: '连招推荐 · 检查工作区' },
    ],
  },
  {
    pattern: /^git\s+pull/i,
    transitions: [
      { template: () => 'npm install', confidence: 0.82, reason: '连招推荐 · 更新依赖' },
      { template: () => 'pnpm install', confidence: 0.8, reason: '连招推荐 · 更新依赖' },
      { template: () => 'git status', confidence: 0.78, reason: '连招推荐 · 检查合并状态' },
      { template: () => 'git log -n 3', confidence: 0.68, reason: '连招推荐 · 查看最新拉取' },
    ],
  },
  {
    pattern: /^git\s+(?:checkout\s+-b|switch\s+-c)\s+/i,
    transitions: [
      {
        template: (slots) => (slots.targetBranch ? `git push -u origin ${slots.targetBranch}` : 'git push -u origin'),
        confidence: 0.88,
        reason: '连招推荐 · 推送新分支到远端',
      },
      { template: () => 'git status', confidence: 0.82, reason: '连招推荐 · 检查新分支状态' },
    ],
  },
  {
    pattern: /^git\s+stash(\s+save|\s+push|\s*$)/i,
    transitions: [
      { template: () => 'git pull', confidence: 0.86, reason: '连招推荐 · 暂存后拉取' },
      { template: () => 'git stash pop', confidence: 0.84, reason: '连招推荐 · 恢复暂存改动' },
    ],
  },

  {
    pattern: /^git\s+clone\s+/i,
    transitions: [
      {
        template: (slots) => (slots.extractedDir ? `cd ${slots.extractedDir}` : 'ls -la'),
        confidence: 0.94,
        reason: '连招推荐 · 进入克隆的仓库目录',
      },
    ],
  },

  // 目录与解压工作流
  {
    pattern: /^mkdir/i,
    transitions: [
      {
        template: (slots) => (slots.targetPath ? `cd ${slots.targetPath}` : 'cd'),
        confidence: 0.95,
        reason: '连招推荐 · 进入刚创建的目录',
      },
    ],
  },
  {
    pattern: /^tar\s+-[a-zA-Z]*x/i,
    transitions: [
      {
        template: (slots) => (slots.extractedDir ? `cd ${slots.extractedDir}` : 'ls -lh'),
        confidence: 0.9,
        reason: '连招推荐 · 进入解压后的目录',
      },
    ],
  },
  {
    pattern: /^unzip\s+/i,
    transitions: [
      {
        template: (slots) => (slots.extractedDir ? `cd ${slots.extractedDir}` : 'ls -lh'),
        confidence: 0.88,
        reason: '连招推荐 · 进入解压后的目录',
      },
    ],
  },
  {
    pattern: /^cd(\s+.*)?$/i,
    transitions: [
      { template: () => 'ls -la', confidence: 0.88, reason: '连招推荐 · 列出新目录内容' },
      { template: () => 'ls -lh', confidence: 0.85, reason: '连招推荐 · 浏览文件详情' },
    ],
  },

  // Docker 容器运维
  {
    pattern: /^docker\s+ps(\s+.*)?$/i,
    transitions: [
      { template: () => 'docker logs -f ', confidence: 0.86, reason: '连招推荐 · 跟踪容器实时日志' },
      { template: () => 'docker exec -it  bash', confidence: 0.82, reason: '连招推荐 · 进入容器交互' },
      { template: () => 'docker-compose ps', confidence: 0.74, reason: '连招推荐 · 编排状态' },
    ],
  },
  {
    pattern: /^docker(?:-compose|\s+compose)\s+down/i,
    transitions: [
      { template: () => 'docker-compose up -d', confidence: 0.94, reason: '连招推荐 · 重建并启动编排' },
      { template: () => 'docker-compose build', confidence: 0.76, reason: '连招推荐 · 重新构建镜像' },
    ],
  },
  {
    pattern: /^docker(?:-compose|\s+compose)\s+up(\s+-d)?/i,
    transitions: [
      { template: () => 'docker-compose logs -f', confidence: 0.92, reason: '连招推荐 · 观察服务日志' },
      { template: () => 'docker-compose ps', confidence: 0.85, reason: '连招推荐 · 验证服务状态' },
    ],
  },
  {
    pattern: /^docker\s+build\s+/i,
    transitions: [
      { template: () => 'docker images', confidence: 0.85, reason: '连招推荐 · 查看已构建镜像' },
      { template: () => 'docker run -d', confidence: 0.8, reason: '连招推荐 · 运行新镜像' },
    ],
  },

  // Systemd 服务运维
  {
    pattern: /^systemctl\s+restart\s+/i,
    transitions: [
      {
        template: (slots) => (slots.targetService ? `systemctl status ${slots.targetService}` : 'systemctl status'),
        confidence: 0.96,
        reason: '连招推荐 · 验证重启后状态',
      },
      {
        template: (slots) => (slots.targetService ? `journalctl -u ${slots.targetService} -f` : 'journalctl -f'),
        confidence: 0.84,
        reason: '连招推荐 · 跟踪服务最新日志',
      },
    ],
  },
  {
    pattern: /^systemctl\s+stop\s+/i,
    transitions: [
      {
        template: (slots) => (slots.targetService ? `systemctl status ${slots.targetService}` : 'systemctl status'),
        confidence: 0.92,
        reason: '连招推荐 · 确认停止状态',
      },
      {
        template: (slots) => (slots.targetService ? `systemctl start ${slots.targetService}` : 'systemctl start'),
        confidence: 0.8,
        reason: '连招推荐 · 重新启动服务',
      },
    ],
  },
  {
    pattern: /^systemctl\s+start\s+/i,
    transitions: [
      {
        template: (slots) => (slots.targetService ? `systemctl status ${slots.targetService}` : 'systemctl status'),
        confidence: 0.94,
        reason: '连招推荐 · 检查运行状态',
      },
    ],
  },

  // 包管理与构建
  {
    pattern: /^(?:npm|pnpm|yarn)\s+install/i,
    transitions: [
      { template: () => 'npm run dev', confidence: 0.88, reason: '连招推荐 · 启动开发服务' },
      { template: () => 'pnpm dev', confidence: 0.85, reason: '连招推荐 · 启动开发服务' },
      { template: () => 'npm test', confidence: 0.72, reason: '连招推荐 · 运行本地测试' },
    ],
  },
  {
    pattern: /^(?:npm|pnpm|yarn)\s+run\s+build/i,
    transitions: [
      { template: () => 'npm run preview', confidence: 0.84, reason: '连招推荐 · 预览生产构建' },
      { template: () => 'npm start', confidence: 0.8, reason: '连招推荐 · 启动生产实例' },
    ],
  },

  // 资源与网络排查
  {
    pattern: /^df\s+-h/i,
    transitions: [
      { template: () => 'du -sh * | sort -hr | head -n 10', confidence: 0.88, reason: '连招推荐 · 定位大文件目录' },
      { template: () => 'lsblk', confidence: 0.75, reason: '连招推荐 · 查看挂载块设备' },
    ],
  },
  {
    pattern: /^(?:netstat|ss)\s+/i,
    transitions: [
      { template: () => 'lsof -i', confidence: 0.82, reason: '连招推荐 · 查明占用进程详情' },
    ],
  },
  {
    pattern: /^nginx\s+-t/i,
    transitions: [
      { template: () => 'systemctl reload nginx', confidence: 0.95, reason: '连招推荐 · 配置校验通过后平滑重载' },
      { template: () => 'nginx -s reload', confidence: 0.88, reason: '连招推荐 · 平滑重载 Nginx' },
    ],
  },
]

/**
 * 终端输出报错感知与一键修复推荐（Output-Driven Smart Fix）
 *
 * 分析上一条命令及其终端末尾输出，识别高频错误并生成精准修复建议：
 * - Permission denied / EACCES -> sudo 重试或 chmod +x
 * - git push 无上游分支 -> 自动提取 git push --set-upstream origin <branch>
 * - git push non-fast-forward -> git pull --rebase
 * - git local changes would be overwritten -> git stash
 * - Address already in use / EADDRINUSE -> lsof -i :<port>
 * - dpkg was interrupted -> sudo dpkg --configure -a
 * - command not found -> 平台包管理器安装建议
 */
export function analyzeOutputForSmartFixes(
  lastCommand: string | null | undefined,
  recentOutput: string | null | undefined,
  platform: Platform = 'universal',
): MarkovPrediction[] {
  const cmd = (lastCommand || '').trim()
  const out = (recentOutput || '').trim()
  if (!cmd || !out) return []

  const fixes: MarkovPrediction[] = []
  const seen = new Set<string>()
  const pushFix = (command: string, confidence: number, reason: string) => {
    if (!command || seen.has(command)) return
    seen.add(command)
    fixes.push({
      command,
      confidence,
      reason,
      source: 'diagnostic',
    })
  }

  // 1. Git push 缺少上游分支（直接从 git 报错文本提取完整命令）
  const upstreamMatch = out.match(/git\s+push\s+--set-upstream\s+([a-zA-Z0-9_.-]+)\s+([a-zA-Z0-9_./-]+)/i)
  if (upstreamMatch) {
    pushFix(
      `git push --set-upstream ${upstreamMatch[1]} ${upstreamMatch[2]}`,
      0.99,
      '报错修复 · 自动关联远端上游分支并推送',
    )
  } else if (/has no upstream branch/i.test(out) && /^git\s+push/i.test(cmd)) {
    pushFix('git push -u origin HEAD', 0.97, '报错修复 · 关联当前分支到远端并推送')
  }

  // 2. Git 远端领先拒绝推送 (non-fast-forward / fetch first)
  if (/non-fast-forward|fetch first|failed to push some refs/i.test(out) && /^git\s+push/i.test(cmd)) {
    pushFix('git pull --rebase', 0.96, '报错修复 · 拉取远端更新并变基合并')
  }

  // 3. Git 本地修改冲突 (would be overwritten by merge/checkout)
  if (/local changes.*would be overwritten|please commit your changes or stash them/i.test(out)) {
    pushFix('git stash', 0.95, '报错修复 · 暂存工作区未提交改动')
  }

  // 4. 权限不足 (Permission denied / EACCES / Operation not permitted)
  if (
    /permission denied|eacces|operation not permitted|are you root|权限不够|拒绝访问/i.test(out) &&
    !/^sudo\s+/i.test(cmd)
  ) {
    const scriptMatch = cmd.match(/^(\.\/\S+)/)
    if (scriptMatch?.[1]) {
      pushFix(
        `chmod +x ${scriptMatch[1]} && ${cmd}`,
        0.98,
        '报错修复 · 赋予脚本可执行权限并重试',
      )
    }
    pushFix(`sudo ${cmd}`, 0.97, '报错修复 · 权限不足，使用 sudo 提权执行')
  }

  // 5. 端口被占用 (Address already in use / EADDRINUSE)
  if (/address already in use|eaddrinuse|bind:\s*address already in use/i.test(out)) {
    const portMatch =
      out.match(/(?:port\s+|:\s*)(\d{2,5})\b/i) ||
      cmd.match(/(?:-p\s*|--port[=\s]+|:)(\d{2,5})\b/i)
    const port = portMatch?.[1]
    if (port) {
      pushFix(`lsof -i :${port}`, 0.97, `报错修复 · 查找占用端口 :${port} 的进程`)
      pushFix(`ss -tulpn | grep :${port}`, 0.92, `报错修复 · 检查端口 :${port} 监听详情`)
    } else {
      pushFix('ss -tulpn', 0.9, '报错修复 · 查看当前所有监听端口与进程')
    }
  }

  // 6. dpkg 中断修复
  if (/dpkg was interrupted/i.test(out)) {
    pushFix('sudo dpkg --configure -a', 0.99, '报错修复 · 修复中断的 dpkg 软件包配置')
  }

  // 7. 命令未找到 (command not found) -> 结合发行版提示安装
  const notFoundMatch =
    out.match(/([a-zA-Z0-9_.-]+):\s*command not found/i) ||
    out.match(/command not found:\s*([a-zA-Z0-9_.-]+)/i)
  const missingCmd = notFoundMatch?.[1]
  if (missingCmd && /^[a-zA-Z0-9_.-]{2,32}$/.test(missingCmd)) {
    if (platform === 'debian') {
      pushFix(`sudo apt install -y ${missingCmd}`, 0.89, `报错修复 · 使用 apt 安装 ${missingCmd}`)
    } else if (platform === 'redhat') {
      pushFix(`sudo yum install -y ${missingCmd}`, 0.89, `报错修复 · 使用 yum 安装 ${missingCmd}`)
    } else if (platform === 'alpine') {
      pushFix(`apk add ${missingCmd}`, 0.89, `报错修复 · 使用 apk 安装 ${missingCmd}`)
    } else if (platform === 'arch') {
      pushFix(`sudo pacman -S ${missingCmd}`, 0.89, `报错修复 · 使用 pacman 安装 ${missingCmd}`)
    }
  }

  return fixes
}

/**
 * 记录一条连续命令转移到本地马尔可夫模型中
 */
export function recordMarkovTransition(
  prevCmd: string,
  nextCmd: string,
  cwd?: string,
  scopeId = 'default',
): void {
  const nextClean = nextCmd.trim()
  if (nextClean) {
    updateSessionEntities(nextClean, scopeId)
  }

  const prevClean = prevCmd.trim()
  if (!prevClean || !nextClean || prevClean === nextClean) return

  // 忽略单字母测试性输入或前导空格
  if (prevClean.length < 2 || nextClean.length < 2) return
  if (prevCmd.startsWith(' ') || nextCmd.startsWith(' ')) return

  transitionsCache = null
  predictionCache = null
  const entries = loadLearnedTransitions()
  const now = Date.now()

  // 规范化 from（保留前两个 token 作为转移触发锚点）
  const { base: fromBase } = normalizeCommandPattern(prevClean)
  const normFrom = fromBase || prevClean

  // cwd 也参与匹配：同一条转移在不同目录下应分开统计，
  // 否则最后一次的 cwd 会覆盖之前所有目录的记录（导致跨目录误推荐）。
  const existingIdx = entries.findIndex(
    (e) =>
      (e.from === normFrom || e.from === prevClean) &&
      e.to === nextClean &&
      (e.cwd || '') === (cwd || ''),
  )

  if (existingIdx >= 0) {
    const existing = entries[existingIdx]
    entries.splice(existingIdx, 1)
    const nextCount = existing.count + 1
    entries.unshift({
      from: normFrom,
      to: nextClean,
      count: nextCount,
      lastUsed: now,
      cwd: cwd || existing.cwd,
    })
    // 当某条转移达到 1000 次时，对该前驱命令（from）下的所有转移执行等比折半归一化：
    // 既保留同一前驱下各后继动作的相对概率比例（如 1000:400 -> 500:200），又避免频繁触发或数值超过三位数
    if (nextCount >= 1000) {
      for (const item of entries) {
        if (item.from === normFrom || item.from === prevClean) {
          item.count = Math.max(1, Math.round(item.count * 0.5))
        }
      }
    }
  } else {
    entries.unshift({
      from: normFrom,
      to: nextClean,
      count: 1,
      lastUsed: now,
      cwd,
    })
  }

  // 剪裁超限条目
  if (entries.length > MAX_LEARNED_TRANSITIONS) {
    entries.length = MAX_LEARNED_TRANSITIONS
  }
  saveLearnedTransitions(entries)
}

/**
 * 收集某前置命令下的全部候选（不含输入前缀过滤），并按置信度降序。
 *
 * 拆出独立函数的原因：候选集合只由 `prevCommand + cwd` 决定，与用户当前键入的
 * 前缀无关；而终端每次按键都会调用预测。把「遍历 learned(≤600) + builtin 规则」
 * 的结果缓存起来，按键时只做 O(候选数) 的前缀过滤，避免热路径重复计算。
 */
function collectMarkovCandidates(
  prevCommand: string,
  cwd?: string | null,
  scopeId = 'default',
  serverId?: string,
): MarkovPrediction[] {
  const cleanPrev = prevCommand.trim()
  // 融合会话级最近实体记忆与紧邻上一条命令提取的槽位（当前命令槽位优先，缺失项由会话记忆补齐）
  const sessionSlots = getSessionEntities(scopeId)
  const immediateSlots = extractSlotsFromCommand(cleanPrev)
  const slots: ExtractedSlots = { ...sessionSlots, ...immediateSlots }
  const { base: prevBase } = normalizeCommandPattern(cleanPrev)

  // 零开销读取当前目录缓存文件列表（若已缓存），用于识别 pnpm / yarn / Cargo / Compose 项目特征
  const dirEntries = getCachedDirEntryNames(serverId, cwd)
  const hasPnpmLock = dirEntries.has('pnpm-lock.yaml')
  const hasYarnLock = dirEntries.has('yarn.lock')
  const hasComposeFile =
    dirEntries.has('docker-compose.yml') ||
    dirEntries.has('docker-compose.yaml') ||
    dirEntries.has('compose.yml') ||
    dirEntries.has('compose.yaml')

  const candidates: MarkovPrediction[] = []
  const seenCommands = new Set<string>()

  // 1. 优先检索自主学习转移库 (Learned Transitions)
  const learned = loadLearnedTransitions()
  const now = Date.now()
  const DAY_MS = 86_400_000

  for (const entry of learned) {
    const matchFrom = entry.from === cleanPrev || entry.from === prevBase
    if (!matchFrom) continue

    // 跨目录过滤：只丢弃 `cd <相对路径>` 类连招——相对路径在不同目录下几乎必然失效
    // （例：在 ~/vector 下记录的 `cd datadir`，回到 home 后不该推荐）。
    // 其他命令（如 `npm run prod`、`ls -la`）跨目录仍可能有效，靠 cwd 加权区分即可。
    const isRelativeCd = /^cd\s+(?![/~])/.test(entry.to)
    if (isRelativeCd && entry.cwd && cwd && entry.cwd !== cwd) continue

    const cmd = entry.to
    if (seenCommands.has(cmd)) continue

    // 综合打分：频次 log + 时效衰减 + 当前 CWD 目录加权
    const countScore = Math.min(0.4, Math.log2(entry.count + 1) * 0.1)
    const daysAgo = (now - entry.lastUsed) / DAY_MS
    const recencyScore = daysAgo < 3 ? 0.35 : Math.max(0.1, 0.35 - daysAgo * 0.03)
    const cwdBonus = cwd && entry.cwd && cwd === entry.cwd ? 0.25 : 0

    const confidence = Math.min(0.99, 0.4 + countScore + recencyScore + cwdBonus)
    const countLabel = entry.count > 999 ? '999+' : String(entry.count)
    seenCommands.add(cmd)
    candidates.push({
      command: cmd,
      confidence,
      reason: `习惯连招 · 已执行 ${countLabel} 次`,
      source: 'learned',
    })
  }

  // 2. 检索内置通用工程拓扑规则 (Builtin Priors)
  for (const rule of BUILTIN_WORKFLOW_PRIORS) {
    const matches = typeof rule.pattern === 'string' ? cleanPrev.includes(rule.pattern) : rule.pattern.test(cleanPrev)
    if (!matches) continue

    for (const t of rule.transitions) {
      const generated = t.template(slots, cleanPrev)
      const list = Array.isArray(generated) ? generated : [generated]

      for (const cmd of list) {
        if (!cmd || seenCommands.has(cmd)) continue
        seenCommands.add(cmd)
        let confidence = t.confidence
        // 根据当前目录锁文件动态微调包管理器权重
        if (hasPnpmLock) {
          if (cmd.startsWith('pnpm ')) confidence = Math.min(0.98, confidence + 0.1)
          else if (cmd.startsWith('npm ')) confidence = Math.max(0.5, confidence - 0.1)
        } else if (hasYarnLock && cmd.startsWith('npm ')) {
          confidence = Math.max(0.5, confidence - 0.08)
        }
        candidates.push({
          command: cmd,
          confidence,
          reason: t.reason,
          source: 'builtin',
        })
      }
    }
  }

  // 若刚 cd 进入含 docker-compose.yml 的目录，主动补充编排状态连招
  if (/^cd(\s+.*)?$/i.test(cleanPrev) && hasComposeFile && !seenCommands.has('docker compose ps')) {
    seenCommands.add('docker compose ps')
    candidates.push({
      command: 'docker compose ps',
      confidence: 0.9,
      reason: '连招推荐 · 检测到 Compose 项目，查看容器状态',
      source: 'builtin',
    })
  }

  // 按置信度降序
  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates
}

/**
 * 根据前置命令与当前输入前缀，推断下一个高概率指令
 */
export function predictNextMarkovCommands(
  prevCommand: string | null | undefined,
  currentInputPrefix: string,
  cwd?: string | null,
  limit = 3,
  opts?: {
    scopeId?: string
    serverId?: string
    lastOutput?: string | null
    platform?: Platform
  },
): MarkovPrediction[] {
  const cleanPrev = (prevCommand || '').trim()
  if (!cleanPrev) return []

  const q = currentInputPrefix.trimStart()
  const qLower = q.toLowerCase()
  const scopeId = opts?.scopeId ?? 'default'
  const serverId = opts?.serverId

  // 1. 终端报错输出感知修复（最高优先级）
  const smartFixes = opts?.lastOutput
    ? analyzeOutputForSmartFixes(cleanPrev, opts.lastOutput, opts.platform)
    : []

  // 2. 候选只由 prevCommand + cwd + scopeId 决定；前缀仅做最后过滤 → 缓存避免每键 O(600+)
  const cacheKey = `${cleanPrev}\0${cwd ?? ''}\0${scopeId}\0${serverId ?? ''}`
  if (!predictionCache || predictionCache.key !== cacheKey) {
    predictionCache = {
      key: cacheKey,
      candidates: collectMarkovCandidates(cleanPrev, cwd, scopeId, serverId),
    }
  }

  const merged: MarkovPrediction[] = []
  const seen = new Set<string>()
  for (const item of [...smartFixes, ...predictionCache.candidates]) {
    if (seen.has(item.command)) continue
    seen.add(item.command)
    merged.push(item)
  }

  if (!qLower) return merged.slice(0, limit)
  return merged
    .filter((c) => c.command.toLowerCase().startsWith(qLower))
    .slice(0, limit)
}

/**
 * 计算完整命令行模板补全后的光标回退格数：
 * - 末尾为 `""` 或 `''`（如 `git commit -m ""`）→ 回退 1 格，让光标直接落在引号内
 * - 含双空格占位（如 `docker exec -it  bash`）→ 回退到双空格中间，方便直接敲容器名
 */
export function computeCommandCursorBack(cmd: string): number | undefined {
  if (cmd.endsWith('""') || cmd.endsWith("''")) {
    return 1
  }
  const doubleSpaceIdx = cmd.indexOf('  ')
  if (doubleSpaceIdx > 0) {
    return cmd.length - (doubleSpaceIdx + 1)
  }
  return undefined
}

/**
 * 将马尔可夫模型预测结果转化为 HintPanel 可渲染的 HintItem[]
 */
export function getMarkovHintItems(
  prevCommand: string | null | undefined,
  currentInput: string,
  cwd?: string | null,
  limit = 2,
  opts?: {
    scopeId?: string
    serverId?: string
    lastOutput?: string | null
    platform?: Platform
  },
): HintItem[] {
  const predictions = predictNextMarkovCommands(prevCommand, currentInput, cwd, limit, opts)
  if (predictions.length === 0) return []

  return predictions.map((p) => {
    const isDiag = p.source === 'diagnostic'
    return {
      kind: 'markov' as const,
      label: p.command,
      desc: p.reason,
      insertText: p.command,
      badge: isDiag ? '报错修复' : p.source === 'learned' ? '习惯连招' : '连招',
      cursorBack: computeCommandCursorBack(p.command),
      // 评分赋予超高权重（2000+），保证在命令名输入阶段稳居候选首位
      score: (isDiag ? 2300 : 2000) + Math.round(p.confidence * 200),
    }
  })
}

/** 清空自主学习的马尔可夫转移缓存 */
export function clearMarkovHistory(): void {
  transitionsCache = null
  predictionCache = null
  sessionEntityMemory.clear()
  saveLearnedTransitions([])
}
