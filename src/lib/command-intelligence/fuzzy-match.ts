/**
 * 模糊匹配评分
 *
 * 参考 Sublime Text / VSCode 的 fzf 思路：
 * - 连续匹配加分（奖励"相邻"匹配，体现单词完整性）
 * - 首字母/词边界匹配加分
 * - 大小写完全一致加分
 * - 完全前缀匹配给最高分，确保前缀匹配排在模糊匹配前
 *
 * 返回 -1 表示不匹配；≥0 越大越靠前。
 *
 * 子串匹配限制：query 长度 < 4 时不启用子串匹配，
 * 避免短查询产生噪声（如 "doc" 匹配 "lazydocker" 让用户困惑）。
 * 短查询仅保留前缀匹配 + 字符顺序模糊匹配。
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // 完全相等：满分
  if (q === t) return 1000

  // 前缀匹配：高分
  if (t.startsWith(q)) {
    // 越短的目标，前缀匹配越精准，得分越高
    return 500 - (t.length - q.length)
  }

  // 子串匹配：仅对长度 >= 4 的查询启用，短查询跳过以减少噪声
  if (q.length >= 4) {
    const subIdx = t.indexOf(q)
    if (subIdx >= 0) {
      // 起始位置越靠前越好；目标越短越好
      let s = 200 - subIdx * 5
      if (subIdx === 0) s += 50
      return s - (t.length - q.length)
    }
  }

  // 模糊匹配：query 各字符按序出现在 target 中
  let qi = 0
  let score = 0
  let lastIdx = -1
  let consecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // 词边界奖励：匹配位置是开头，或前一字符是 - _ / . 空格
      const isBoundary = ti === 0 || /[-_/. ]/.test(t[ti - 1])
      if (isBoundary) score += 15

      // 连续匹配奖励
      if (lastIdx === ti - 1) {
        consecutive++
        score += consecutive * 8
      } else {
        consecutive = 0
      }

      // 大小写完全一致额外加分
      if (target[ti] === query[qi]) score += 2

      lastIdx = ti
      qi++
    } else {
      consecutive = 0
    }
  }

  // 全部 query 字符都找到了才算模糊匹配成功
  if (qi < q.length) return -1

  // 模糊匹配基础分较低，但加上各种奖励
  return 30 + score
}

/** 按得分降序排序，得分相同按字典序 */
export function sortByScore<T>(items: T[], getScore: (item: T) => number): T[] {
  return items
    .map((item) => ({ item, score: getScore(item) }))
    .sort((a, b) => b.score - a.score || String(a.item).localeCompare(String(b.item)))
    .map((x) => x.item)
}
