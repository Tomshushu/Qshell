/**
 * 命令历史持久化与基于前缀的推荐
 *
 * 设计目标：
 * - 记录用户在终端执行过的命令（按 Enter 提交时写入）
 * - 持久化到 localStorage，跨会话保留
 * - 按使用次数 + 最近使用时间排序，实现"最近使用"推荐
 * - 输入前缀时优先推荐历史中匹配的完整命令
 *
 * 与 completion-engine 解耦：引擎在 command 阶段只匹配静态命令库，
 * 历史推荐由 terminal.tsx 单独调用本模块，与静态提示合并展示。
 */

import type { HintItem } from './types'

/** 单条历史记录 */
export interface HistoryEntry {
  /** 完整命令行 */
  cmd: string
  /** 最近一次使用时间戳（ms） */
  usedAt: number
  /** 累计使用次数 */
  useCount: number
  /** 最近一次执行该命令的服务器 ID */
  lastServerId?: string
  /** 最近一次执行该命令的工作目录 */
  lastCwd?: string
  /** 按服务器统计的执行次数（serverId → count） */
  serverCounts?: Record<string, number>
  /** 按工作目录统计的执行次数（cwd → count） */
  cwdCounts?: Record<string, number>
}

/** 历史命令上下文（主机 + 目录） */
export interface HistoryContext {
  serverId?: string
  cwd?: string | null
}

/** localStorage 键名 */
const STORAGE_KEY = 'trae:command-history'

/** 最大保留条数（防止 localStorage 无限增长） */
const MAX_ENTRIES = 500

/** 内存缓存，避免每次操作都读 localStorage */
let cache: HistoryEntry[] | null = null

// H6 修复：监听跨窗口 storage 事件，其他窗口修改命令历史时清除本地缓存，
// 避免本窗口的 stale cache 覆盖其他窗口的写入
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cache = null
    }
  })
}

/** 从 localStorage 读取历史（带内存缓存） */
function load(): HistoryEntry[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      cache = []
      return cache
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      cache = []
      return cache
    }
    // 兼容性过滤：只保留合法结构
    cache = parsed.filter(
      (e) => e && typeof e.cmd === 'string' && typeof e.usedAt === 'number',
    )
    return cache
  } catch {
    cache = []
    return cache
  }
}

/** 写入 localStorage（失败时静默，不影响终端使用） */
function persist(entries: HistoryEntry[]): void {
  cache = entries
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // localStorage 满或被禁用，忽略
  }
}

/** 每个历史条目最多记录的不同目录数（防止 JSON 膨胀） */
const MAX_CWD_BUCKETS_PER_ENTRY = 10
/**
 * 触发全局等比折半归一化（Proportional Rescaling）的次数阈值。
 * 当任意一条命令累计达到 1000 次时，全表所有命令的计数按 RESCALE_FACTOR (0.5) 等比缩放：
 * 1. 相对频次比例严格保留（如 1000:600:200 缩放为 500:300:100），既不会频繁触发折半，又杜绝多条常用指令触顶后权重趋同；
 * 2. 陈旧命令随时间自然向 1 衰减，新养成的高频习惯可公平追赶；
 * 3. 显示数字天然控制在 1~999（最多三位数），永远不会撑破弹窗单行宽度。
 */
export const HISTORY_RESCALE_THRESHOLD = 1000
const HISTORY_RESCALE_FACTOR = 0.5

/** 格式化使用次数展示（配合满 1000 折半天然保持在 1~999，对外部异常大数兜底 999+） */
export function formatUseCount(count = 1): string {
  return count > 999 ? '999+' : String(Math.max(1, count))
}

/**
 * 对历史命令表执行全局等比缩放归一化（同步缩放 useCount、serverCounts、cwdCounts）
 */
function rescaleHistoryEntries(entries: HistoryEntry[]): void {
  for (const entry of entries) {
    entry.useCount = Math.max(1, Math.round((entry.useCount ?? 1) * HISTORY_RESCALE_FACTOR))
    if (entry.serverCounts) {
      for (const sid of Object.keys(entry.serverCounts)) {
        entry.serverCounts[sid] = Math.max(
          1,
          Math.round(entry.serverCounts[sid] * HISTORY_RESCALE_FACTOR),
        )
      }
    }
    if (entry.cwdCounts) {
      for (const dir of Object.keys(entry.cwdCounts)) {
        entry.cwdCounts[dir] = Math.max(
          1,
          Math.round(entry.cwdCounts[dir] * HISTORY_RESCALE_FACTOR),
        )
      }
    }
  }
}

/**
 * 记录一条命令到历史。
 *
 * 规则：
 * - 同名命令已存在 → useCount+1，更新 usedAt 及主机/目录频次分布
 * - 当 useCount 达到 HISTORY_RESCALE_THRESHOLD (100) 时触发全表等比折半归一化
 * - 新命令 → 插入到头部
 * - 超过 MAX_ENTRIES 时丢弃尾部（最久未用）
 * - 跳过空命令、纯空白、以空格开头的命令（shell 中前导空格表示不记录历史，此处对齐）
 *
 * @param cmd 完整命令行（已 trim）
 * @param context 可选上下文（当前 serverId 与 cwd）
 */
export function recordCommand(cmd: string, context?: HistoryContext): void {
  const trimmed = cmd.trim()
  if (!trimmed) return
  // 前导空格的命令不记录（与 bash HISTCONTROL=ignorespace 行为一致）
  if (cmd.startsWith(' ')) return

  // H6: 多窗口场景下，先清除缓存从 localStorage 读取最新值，
  // 避免本窗口的 stale cache 覆盖其他窗口的写入
  cache = null
  const entries = load()
  const now = Date.now()
  const serverId = context?.serverId?.trim() || undefined
  const cwd = context?.cwd?.trim() || undefined

  const idx = entries.findIndex((e) => e.cmd === trimmed)
  if (idx >= 0) {
    const existing = entries[idx]
    entries.splice(idx, 1)
    const serverCounts = existing.serverCounts ? { ...existing.serverCounts } : undefined
    if (serverId) {
      const nextServerCounts = serverCounts ?? {}
      nextServerCounts[serverId] = (nextServerCounts[serverId] ?? 0) + 1
      existing.serverCounts = nextServerCounts
    }
    let cwdCounts = existing.cwdCounts ? { ...existing.cwdCounts } : undefined
    if (cwd) {
      cwdCounts = cwdCounts ?? {}
      cwdCounts[cwd] = (cwdCounts[cwd] ?? 0) + 1
      const keys = Object.keys(cwdCounts)
      if (keys.length > MAX_CWD_BUCKETS_PER_ENTRY) {
        delete cwdCounts[keys[0]]
      }
    }
    const nextUseCount = (existing.useCount ?? 0) + 1
    entries.unshift({
      cmd: trimmed,
      usedAt: now,
      useCount: nextUseCount,
      lastServerId: serverId ?? existing.lastServerId,
      lastCwd: cwd ?? existing.lastCwd,
      serverCounts: existing.serverCounts,
      cwdCounts,
    })
    if (nextUseCount >= HISTORY_RESCALE_THRESHOLD) {
      rescaleHistoryEntries(entries)
    }
  } else {
    entries.unshift({
      cmd: trimmed,
      usedAt: now,
      useCount: 1,
      lastServerId: serverId,
      lastCwd: cwd,
      serverCounts: serverId ? { [serverId]: 1 } : undefined,
      cwdCounts: cwd ? { [cwd]: 1 } : undefined,
    })
  }

  // 超限裁剪
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES
  }
  persist(entries)
}

/**
 * 历史命令匹配判定：
 * - `'prefix'`：完整前缀匹配（如 `git c` → `git commit -m "fix"`），基础奖励最高
 * - `'multi-token'`：多词分段前缀匹配（如 `g co` → `git checkout main`，`stl r` → `systemctl restart nginx`）
 * - `'acronym'`：多词首字母缩写匹配（如 `dcu` → `docker compose up -d`，`kga` → `kubectl get all`）
 * - `null`：不匹配
 */
function matchHistoryQuery(
  queryLower: string,
  cmdLower: string,
): 'prefix' | 'multi-token' | 'acronym' | null {
  if (cmdLower.startsWith(queryLower)) {
    return 'prefix'
  }

  const cmdTokens = cmdLower.split(/\s+/).filter(Boolean)
  if (cmdTokens.length < 2) return null

  // 多词分段前缀匹配（如 "g co" 匹配 "git checkout main"）
  if (queryLower.includes(' ')) {
    const qTokens = queryLower.split(/\s+/).filter(Boolean)
    if (qTokens.length >= 2 && qTokens.length <= cmdTokens.length) {
      const allPrefix = qTokens.every((qt, i) => cmdTokens[i].startsWith(qt))
      if (allPrefix) return 'multi-token'
    }
    return null
  }

  // 单词首字母缩写匹配（仅当长度 3~5 且完全由字母组成时，如 dcu -> docker compose up）
  if (
    queryLower.length >= 3 &&
    queryLower.length <= 5 &&
    /^[a-z]+$/.test(queryLower) &&
    cmdTokens.length >= queryLower.length
  ) {
    let matched = true
    for (let i = 0; i < queryLower.length; i++) {
      const tok = cmdTokens[i].replace(/^-+/, '')
      if (!tok || tok[0] !== queryLower[i]) {
        matched = false
        break
      }
    }
    if (matched) return 'acronym'
  }

  return null
}

/**
 * 基于前缀/缩写与上下文（ServerId + CWD）推荐历史命令。
 *
 * 排序策略（三维 Frecency = 频率 × 时效 + 主机亲和度 + 目录亲和度）：
 * - 完整前缀匹配优先于多词缩写匹配
 * - 同主机 + 同工作目录执行过的历史命令显著加权置顶，避免跨主机历史串味
 * - 仅在其他主机执行过的命令适度降权
 *
 * @param prefix 用户当前输入（支持任意阶段，如 'git'、'git c'、'docker exec -it '、'g co'）
 * @param maxItems 最大返回条数
 * @param context 可选上下文（当前 serverId 与 cwd）
 * @returns HintItem[]，kind='history'
 */
export function suggestHistory(
  prefix: string,
  maxItems = 5,
  context?: HistoryContext,
): HintItem[] {
  const entries = load()
  if (entries.length === 0) return []

  const q = prefix.trimStart()
  const qTrimmed = q.trim()
  if (!qTrimmed) return []

  const lower = q.toLowerCase()
  const lowerTrimmed = qTrimmed.toLowerCase()
  const now = Date.now()
  const DAY_MS = 86_400_000
  const curServerId = context?.serverId?.trim() || undefined
  const curCwd = context?.cwd?.trim() || undefined

  const scored: Array<{
    e: HistoryEntry
    score: number
    badge?: string
    matchKind: 'prefix' | 'multi-token' | 'acronym'
  }> = []

  for (const e of entries) {
    const cmdLower = e.cmd.toLowerCase()
    // 若用户末尾输入了空格（如 "docker exec "），优先严格按带空格前缀匹配，避免缩写干扰
    const matchKind = /\s$/.test(q)
      ? cmdLower.startsWith(lower)
        ? 'prefix'
        : null
      : matchHistoryQuery(lowerTrimmed, cmdLower)
    if (!matchKind) continue

    // 跨目录相对 cd 过滤：在其他目录记录的相对路径 `cd xxx` 不跨目录推荐
    if (curCwd && e.lastCwd && e.lastCwd !== curCwd && /^cd\s+(?![/~-])/.test(e.cmd)) {
      const hasUsedInCurCwd = Boolean(e.cwdCounts?.[curCwd])
      if (!hasUsedInCurCwd) continue
    }

    // 1. 匹配形态基础分
    const matchTypeBonus =
      matchKind === 'prefix' ? 40 : matchKind === 'multi-token' ? 18 : 8

    // 2. 频次得分：log 缓解高频命令霸榜
    const freqScore = Math.log2((e.useCount ?? 1) + 1) * 10

    // 3. 时效得分：指数平滑衰减（近 1 小时额外加分，7 天内高权重，30 天后渐近归零）
    const daysAgo = Math.max(0, (now - (e.usedAt ?? 0)) / DAY_MS)
    const recencyScore =
      daysAgo < 0.04 ? 36 : daysAgo < 7 ? 30 - daysAgo * 3 : Math.max(0, 10 - (daysAgo - 7))

    // 4. 主机与目录亲和度（Context Affinity）
    let contextBonus = 0
    let badge: string | undefined
    const cwdHits = curCwd ? (e.cwdCounts?.[curCwd] ?? (e.lastCwd === curCwd ? 1 : 0)) : 0
    const serverHits = curServerId
      ? (e.serverCounts?.[curServerId] ?? (e.lastServerId === curServerId ? 1 : 0))
      : 0

    if (cwdHits > 0) {
      contextBonus += 28 + Math.min(12, Math.log2(cwdHits + 1) * 4)
      badge = '当前目录'
    }
    if (serverHits > 0) {
      contextBonus += 22 + Math.min(10, Math.log2(serverHits + 1) * 3)
      if (!badge) badge = '同主机'
    } else if (
      curServerId &&
      ((e.serverCounts && Object.keys(e.serverCounts).length > 0) || e.lastServerId)
    ) {
      // 仅在其他服务器执行过，轻微降权防止喧宾夺主
      contextBonus -= 12
    }

    // 完全相等（用户输入就是历史命令）给最高分
    const exactBonus = e.cmd === qTrimmed ? 50 : 0

    scored.push({
      e,
      score: matchTypeBonus + freqScore + recencyScore + contextBonus + exactBonus,
      badge,
      matchKind,
    })
  }

  scored.sort((a, b) => b.score - a.score || a.e.cmd.localeCompare(b.e.cmd))

  return scored.slice(0, maxItems).map(({ e, score, badge }) => {
    const endsWithEmptyQuotes = e.cmd.endsWith('""') || e.cmd.endsWith("''")
    const countText = `${formatUseCount(e.useCount ?? 1)} 次`
    return {
      kind: 'history' as const,
      label: e.cmd,
      desc: badge ? `${badge} · ${countText}` : `最近使用 · ${countText}`,
      insertText: e.cmd,
      usedAt: e.usedAt,
      useCount: e.useCount,
      score,
      badge,
      cursorBack: endsWithEmptyQuotes ? 1 : undefined,
    }
  })
}

/** 清空全部历史 */
export function clearHistory(): void {
  persist([])
}

/** 获取全部历史（供调试或导出用） */
export function getHistory(): HistoryEntry[] {
  return load().slice()
}
