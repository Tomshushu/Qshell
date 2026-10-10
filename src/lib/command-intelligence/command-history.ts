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

/**
 * 记录一条命令到历史。
 *
 * 规则：
 * - 同名命令已存在 → useCount+1，更新 usedAt
 * - 新命令 → 插入到头部
 * - 超过 MAX_ENTRIES 时丢弃尾部（最久未用）
 * - 跳过空命令、纯空白、以空格开头的命令（shell 中前导空格表示不记录历史，此处对齐）
 *
 * @param cmd 完整命令行（已 trim）
 */
export function recordCommand(cmd: string): void {
  const trimmed = cmd.trim()
  if (!trimmed) return
  // 前导空格的命令不记录（与 bash HISTCONTROL=ignorespace 行为一致）
  if (cmd.startsWith(' ')) return

  // H6: 多窗口场景下，先清除缓存从 localStorage 读取最新值，
  // 避免本窗口的 stale cache 覆盖其他窗口的写入
  cache = null
  const entries = load()
  const now = Date.now()
  const idx = entries.findIndex((e) => e.cmd === trimmed)
  if (idx >= 0) {
    const existing = entries[idx]
    entries.splice(idx, 1)
    entries.unshift({
      cmd: trimmed,
      usedAt: now,
      useCount: (existing.useCount ?? 0) + 1,
    })
  } else {
    entries.unshift({ cmd: trimmed, usedAt: now, useCount: 1 })
  }

  // 超限裁剪
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES
  }
  persist(entries)
}

/**
 * 基于前缀推荐历史命令。
 *
 * 排序策略（综合使用频率与时效）：
 * - 前缀完全匹配优先（startsWith）
 * - 然后按 (useCount 权重 + 最近使用时间衰减) 综合得分降序
 * - 得分相同按字典序
 *
 * @param prefix 用户当前输入（命令名阶段，如 'git'）
 * @param maxItems 最大返回条数
 * @returns HintItem[]，kind='history'
 */
export function suggestHistory(prefix: string, maxItems = 5): HintItem[] {
  const entries = load()
  if (entries.length === 0) return []

  const q = prefix.trim()
  if (!q) return []

  const lower = q.toLowerCase()
  const now = Date.now()
  const DAY_MS = 86_400_000

  const scored = entries
    .filter((e) => e.cmd.toLowerCase().startsWith(lower))
    .map((e) => {
      // 频次得分：log 缓解高频命令霸榜
      const freqScore = Math.log2((e.useCount ?? 1) + 1) * 10
      // 时效得分：7 天内使用的命令加分，超过 30 天衰减为 0
      const daysAgo = (now - (e.usedAt ?? 0)) / DAY_MS
      const recencyScore = daysAgo < 7 ? 30 - daysAgo * 3 : Math.max(0, 10 - (daysAgo - 7))
      // 完全相等（用户输入就是历史命令）给最高分
      const exactBonus = e.cmd === q ? 50 : 0
      return { e, score: freqScore + recencyScore + exactBonus }
    })
    .sort((a, b) => b.score - a.score || a.e.cmd.localeCompare(b.e.cmd))
    .slice(0, maxItems)

  return scored.map(({ e, score }) => ({
    kind: 'history' as const,
    label: e.cmd,
    desc: `最近使用 · ${e.useCount ?? 1} 次`,
    insertText: e.cmd,
    usedAt: e.usedAt,
    useCount: e.useCount,
    score,
  }))
}

/** 清空全部历史 */
export function clearHistory(): void {
  persist([])
}

/** 获取全部历史（供调试或导出用） */
export function getHistory(): HistoryEntry[] {
  return load().slice()
}
