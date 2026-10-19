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

import type { HintItem } from './types'

export interface MarkovPrediction {
  /** 预测的完整命令行 */
  command: string
  /** 转移置信度得分 (0.0 ~ 1.0) */
  confidence: number
  /** 触发原因说明（用于 UI 辅助展示） */
  reason: string
  /** 来源：'builtin'（内置连招先验）或 'learned'（个人行为自主学习） */
  source: 'builtin' | 'learned'
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

/**
 * 槽位参数提取器（Slot Extractor）
 */
export function extractSlotsFromCommand(cmd: string): {
  targetPath?: string
  targetService?: string
  targetBranch?: string
  targetContainer?: string
  extractedDir?: string
} {
  const raw = cmd.trim()
  const result: ReturnType<typeof extractSlotsFromCommand> = {}

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

  // 2. 解压归档 (tar / unzip) -> 提取解压后的大致目录名
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

  // 3. systemctl -> 提取服务名
  const sysMatch = raw.match(/systemctl\s+(start|stop|restart|reload|status|enable|disable)\s+([a-zA-Z0-9_\-@.]+)/i)
  if (sysMatch?.[2]) {
    result.targetService = sysMatch[2]
  }

  // 4. git checkout -b / git switch -c -> 提取分支名
  const branchMatch = raw.match(/git\s+(?:checkout\s+-b|switch\s+-c)\s+([a-zA-Z0-9_\-./]+)/i)
  if (branchMatch?.[1]) {
    result.targetBranch = branchMatch[1]
  }

  // 5. docker -> 提取容器名或镜像
  const dockerRunMatch = raw.match(/docker\s+(?:logs|exec|stop|restart|rm)\s+(?:-[a-zA-Z]+\s+)*([a-zA-Z0-9_\-.]+)/i)
  if (dockerRunMatch?.[1]) {
    result.targetContainer = dockerRunMatch[1]
  }

  return result
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
 * 记录一条连续命令转移到本地马尔可夫模型中
 */
export function recordMarkovTransition(prevCmd: string, nextCmd: string, cwd?: string): void {
  const prevClean = prevCmd.trim()
  const nextClean = nextCmd.trim()
  if (!prevClean || !nextClean || prevClean === nextClean) return

  // 忽略单字母测试性输入或前导空格
  if (prevClean.length < 2 || nextClean.length < 2) return
  if (prevCmd.startsWith(' ') || nextCmd.startsWith(' ')) return

  transitionsCache = null
  const entries = loadLearnedTransitions()
  const now = Date.now()

  // 规范化 from（保留前两个 token 作为转移触发锚点）
  const { base: fromBase } = normalizeCommandPattern(prevClean)
  const normFrom = fromBase || prevClean

  const existingIdx = entries.findIndex(
    (e) => (e.from === normFrom || e.from === prevClean) && e.to === nextClean,
  )

  if (existingIdx >= 0) {
    const existing = entries[existingIdx]
    entries.splice(existingIdx, 1)
    entries.unshift({
      from: normFrom,
      to: nextClean,
      count: existing.count + 1,
      lastUsed: now,
      cwd: cwd || existing.cwd,
    })
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
 * 根据前置命令与当前输入前缀，推断下一个高概率指令
 */
export function predictNextMarkovCommands(
  prevCommand: string | null | undefined,
  currentInputPrefix: string,
  cwd?: string | null,
  limit = 3,
): MarkovPrediction[] {
  if (!prevCommand || !prevCommand.trim()) return []

  const cleanPrev = prevCommand.trim()
  const q = currentInputPrefix.trimStart()
  const qLower = q.toLowerCase()
  const slots = extractSlotsFromCommand(cleanPrev)
  const { base: prevBase } = normalizeCommandPattern(cleanPrev)

  const candidates: MarkovPrediction[] = []
  const seenCommands = new Set<string>()

  // 1. 优先检索自主学习转移库 (Learned Transitions)
  const learned = loadLearnedTransitions()
  const now = Date.now()
  const DAY_MS = 86_400_000

  for (const entry of learned) {
    const matchFrom = entry.from === cleanPrev || entry.from === prevBase
    if (!matchFrom) continue

    const cmd = entry.to
    if (seenCommands.has(cmd)) continue

    // 前缀匹配过滤：如果用户正在键入，命令必须以输入为前缀
    if (q && !cmd.toLowerCase().startsWith(qLower)) {
      continue
    }

    // 综合打分：频次 log + 时效衰减 + 当前 CWD 目录加权
    const countScore = Math.min(0.4, Math.log2(entry.count + 1) * 0.1)
    const daysAgo = (now - entry.lastUsed) / DAY_MS
    const recencyScore = daysAgo < 3 ? 0.35 : Math.max(0.1, 0.35 - daysAgo * 0.03)
    const cwdBonus = cwd && entry.cwd && cwd === entry.cwd ? 0.25 : 0

    const confidence = Math.min(0.99, 0.4 + countScore + recencyScore + cwdBonus)
    seenCommands.add(cmd)
    candidates.push({
      command: cmd,
      confidence,
      reason: `习惯连招 · 已执行 ${entry.count} 次`,
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

        // 前缀过滤
        if (q && !cmd.toLowerCase().startsWith(qLower)) {
          continue
        }

        seenCommands.add(cmd)
        candidates.push({
          command: cmd,
          confidence: t.confidence,
          reason: t.reason,
          source: 'builtin',
        })
      }
    }
  }

  // 按置信度降序
  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates.slice(0, limit)
}

/**
 * 将马尔可夫模型预测结果转化为 HintPanel 可渲染的 HintItem[]
 */
export function getMarkovHintItems(
  prevCommand: string | null | undefined,
  currentInput: string,
  cwd?: string | null,
  limit = 2,
): HintItem[] {
  const predictions = predictNextMarkovCommands(prevCommand, currentInput, cwd, limit)
  if (predictions.length === 0) return []

  return predictions.map((p) => {
    return {
      kind: 'markov' as const,
      label: p.command,
      desc: p.reason,
      insertText: p.command,
      // 评分赋予超高权重（2000+），保证在命令名输入阶段稳居候选首位
      score: 2000 + Math.round(p.confidence * 200),
    }
  })
}

/** 清空自主学习的马尔可夫转移缓存 */
export function clearMarkovHistory(): void {
  saveLearnedTransitions([])
}
