/**
 * 错误纠正（Did you mean?）
 *
 * 当用户在命令名阶段输入了匹配不到任何命令的词（疑似拼写错误），
 * 用编辑距离（Levenshtein）在命令库中找最接近的若干条命令作为建议。
 *
 * 触发条件（由 completion-engine 控制）：
 * - 命令阶段无任何模糊匹配结果
 * - 输入长度 >= 3（过短的输入噪声太大）
 *
 * 排序规则：
 * - 首字母相同的候选优先（拼写错误常保留首字母）
 * - 编辑距离越小越靠前
 * - 距离相同按字典序
 */

import { ALL_COMMANDS } from '@/data/commands'
import type { CommandSpec } from './types'

/**
 * Levenshtein 编辑距离（标准 DP，两行滚动数组）。
 *
 * 返回 a → b 的最少单字符编辑（插入/删除/替换）次数。
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const n = a.length
  const m = b.length
  if (n === 0) return m
  if (m === 0) return n
  let prev = new Array<number>(m + 1)
  let curr = new Array<number>(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    curr[0] = i
    const ac = a[i - 1]
    for (let j = 1; j <= m; j++) {
      const cost = ac === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1, // 插入
        prev[j] + 1, // 删除
        prev[j - 1] + cost, // 替换
      )
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[m]
}

/**
 * 为疑似拼错的查询返回最接近的命令建议。
 *
 * @param query 用户输入（命令名阶段）
 * @param max 最大返回条数
 * @returns CommandSpec[]
 */
export function suggestCorrections(query: string, max = 3): CommandSpec[] {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []
  // 首字母不同直接放弃：真实拼写错误极少改首字母，
  // 强制首字母相同可避免大量跨词误判（如 lscpu 误建议 scp）。
  if (!q[0]) return []

  // 距离阈值：短查询更严格，长查询允许 2
  const threshold = q.length <= 3 ? 1 : 2

  const scored = ALL_COMMANDS
    .map((c) => ({ c, d: levenshtein(q, c.cmd.toLowerCase()) }))
    .filter((x) => x.d > 0 && x.d <= threshold)
    // 强制首字母相同：拼写错误常保留首字母，跨首字母匹配噪声过大
    .filter((x) => x.c.cmd[0].toLowerCase() === q[0])
    .sort((a, b) => {
      // 距离越小越靠前
      if (a.d !== b.d) return a.d - b.d
      return a.c.cmd.localeCompare(b.c.cmd)
    })
    .slice(0, max)
    .map((x) => x.c)

  return scored
}

/**
 * 为疑似拼错的子命令返回最接近的子命令建议。
 *
 * 与 suggestCorrections 对应，但作用域限定在父命令的 subcommands 列表内。
 * 例：git comit → Did you mean commit？
 *
 * @param query 用户输入的子命令名
 * @param parentSpec 父命令 spec（提供 subcommands 搜索范围）
 * @param max 最大返回条数
 * @returns CommandSpec[]
 */
export function suggestSubcommandCorrections(
  query: string,
  parentSpec: CommandSpec,
  max = 3,
): CommandSpec[] {
  const q = query.trim().toLowerCase()
  if (q.length < 3) return []
  if (!q[0]) return []
  if (!parentSpec.subcommands || parentSpec.subcommands.length === 0) return []

  // 距离阈值：子命令通常较短（commit / push / pull），统一用 2
  const threshold = q.length <= 3 ? 1 : 2

  const scored = parentSpec.subcommands
    .map((s) => ({ s, d: levenshtein(q, s.cmd.toLowerCase()) }))
    .filter((x) => x.d > 0 && x.d <= threshold)
    // 强制首字母相同，与 command 阶段纠错一致
    .filter((x) => x.s.cmd[0].toLowerCase() === q[0])
    .sort((a, b) => {
      if (a.d !== b.d) return a.d - b.d
      return a.s.cmd.localeCompare(b.s.cmd)
    })
    .slice(0, max)
    .map((x) => x.s)

  return scored
}
