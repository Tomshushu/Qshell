/**
 * 补全排序（Ranking）
 *
 * 在模糊匹配得分之外，叠加两个信号，让最可能的候选排在最前：
 * 1. 历史使用频次：用户常用命令/子命令加分（频次取 log 缓解霸榜）
 * 2. 命令热度（popularity）：内置的高频命令权重表，保证新用户（无历史）也有合理排序
 *
 * 综合得分 = fuzzyScore + historyBoost + popularityBoost
 *
 * 设计要点：
 * - 历史索引带 5s 内存缓存，避免每次按键都重建
 * - 权重保守，避免完全颠覆模糊匹配；当历史/热度为 0 时退化为原排序
 * - 仅用于 command / subcommand 阶段；参数阶段排序保持纯 fuzzy（参数频次意义有限）
 */

import { getHistory } from './command-history'
import type { HintItem } from './types'

/** 历史频次索引的缓存（label → 累计 useCount） */
let boostCache: Map<string, number> | null = null
let boostCacheTs = 0
const BOOST_CACHE_TTL = 5_000

/**
 * 构建「label → 累计使用次数」索引。
 *
 * label 维度：
 * - 命令名：如 'git' / 'docker'
 * - 命令+子命令：如 'git checkout' / 'docker exec'（用于子命令阶段）
 */
function getBoostMap(): Map<string, number> {
  if (boostCache && Date.now() - boostCacheTs < BOOST_CACHE_TTL) return boostCache
  const map = new Map<string, number>()
  for (const e of getHistory()) {
    const toks = e.cmd.trim().split(/\s+/)
    if (!toks[0]) continue
    map.set(toks[0], (map.get(toks[0]) ?? 0) + (e.useCount ?? 1))
    if (toks[1]) {
      const key = `${toks[0]} ${toks[1]}`
      map.set(key, (map.get(key) ?? 0) + (e.useCount ?? 1))
    }
  }
  boostCache = map
  boostCacheTs = Date.now()
  return map
}

/** 标记历史缓存失效（记录新命令后调用，确保下次重建） */
export function invalidateRankingCache(): void {
  boostCache = null
  boostCacheTs = 0
}

/**
 * 内置命令热度表。
 *
 * 数值无单位，仅作相对权重。选取运维高频命令，保证新用户无历史时
 * 也能把 git/ls/grep 等排在冷门命令前。
 *
 * 键设计：
 * - 顶层命令：直接用命令名（如 'git' / 'ls'）
 * - 子命令：用「父命令.子命令」命名空间（如 'git.checkout' / 'docker.exec'），
 *   避免 logs/exec/start 等通用名在不同分类下互相覆盖。
 */
const POPULARITY: Record<string, number> = {
  // 顶层命令
  git: 60, ls: 55, cd: 55, grep: 50, find: 45, cat: 42, vim: 40, nano: 30,
  cp: 38, mv: 38, rm: 38, mkdir: 35, chmod: 35, chown: 30, tar: 35, gzip: 25,
  ps: 45, top: 40, htop: 35, kill: 40, systemctl: 50, journalctl: 40,
  ssh: 45, scp: 35, rsync: 35, curl: 40, wget: 35, ping: 35, netstat: 35,
  ss: 32, ip: 35, ifconfig: 25, docker: 50, kubectl: 45, apt: 40, yum: 35,
  dnf: 32, pacman: 25, brew: 20, npm: 38, node: 30, python: 30, pip: 28,
  sudo: 45, su: 30, passwd: 28, useradd: 20, df: 38, du: 35, free: 32,
  uname: 25, uptime: 22, who: 20, w: 18, date: 25, cal: 15, echo: 40,
  sed: 35, awk: 38, sort: 30, uniq: 28, head: 32, tail: 35, less: 32,
  more: 20, wc: 25, tee: 25, xargs: 30, which: 25, whereis: 18, locate: 15,
  man: 25, info: 10, history: 22, alias: 20, export: 28, source: 22,

  // git 子命令（命名空间：git.<sub>）
  'git.checkout': 48, 'git.commit': 46, 'git.push': 44, 'git.pull': 42,
  'git.status': 45, 'git.log': 42, 'git.add': 40, 'git.branch': 38,
  'git.merge': 35, 'git.rebase': 30, 'git.fetch': 32, 'git.clone': 30,
  'git.diff': 35, 'git.reset': 30, 'git.stash': 28, 'git.tag': 25,
  'git.remote': 28, 'git.cherry-pick': 22,

  // docker 子命令（命名空间：docker.<sub>）
  'docker.ps': 45, 'docker.exec': 42, 'docker.logs': 40, 'docker.run': 38,
  'docker.stop': 35, 'docker.start': 32, 'docker.restart': 30,
  'docker.build': 32, 'docker.images': 35, 'docker.rm': 32, 'docker.rmi': 28,
  'docker.inspect': 28, 'docker.compose': 40, 'docker.volume': 25,
  'docker.network': 25, 'docker.cp': 22, 'docker.stats': 25, 'docker.top': 22,

  // kubectl 子命令（命名空间：kubectl.<sub>）
  'kubectl.get': 45, 'kubectl.describe': 40, 'kubectl.logs': 42,
  'kubectl.apply': 38, 'kubectl.delete': 35, 'kubectl.edit': 30,
  'kubectl.exec': 35, 'kubectl.port-forward': 25, 'kubectl.scale': 25,
  'kubectl.rollout': 28, 'kubectl.config': 25,

  // systemctl 子命令（命名空间：systemctl.<sub>）
  'systemctl.status': 45, 'systemctl.restart': 42, 'systemctl.start': 38,
  'systemctl.stop': 38, 'systemctl.enable': 35, 'systemctl.disable': 30,
  'systemctl.reload': 30, 'systemctl.list-units': 25,
  'systemctl.list-unit-files': 20, 'systemctl.is-active': 22,
}

/**
 * 取热度权重，缺省 0。
 *
 * 子命令阶段传入 parentCmd 时，优先查「parent.label」命名空间键，
 * 找不到再回退到纯 label（少数未收录子命令仍可用顶层命令热度）。
 */
function popularityOf(label: string, parentCmd?: string): number {
  if (parentCmd) {
    const v = POPULARITY[`${parentCmd}.${label}`]
    if (v !== undefined) return v
  }
  return POPULARITY[label] ?? 0
}

/**
 * 计算单个候选项的综合排序得分。
 *
 * @param item 候选项（必须已带 fuzzy score）
 * @param parentCmd 父命令名（子命令阶段传入，用于查 "git checkout" 这种二级历史）
 * @returns 综合得分，越高越靠前
 */
export function rankScore(item: HintItem, parentCmd?: string): number {
  const fuzzy = item.score ?? 0
  const map = getBoostMap()

  // 历史频次奖励：log 缓解高频霸榜
  let freq: number
  if (parentCmd) {
    // 子命令阶段：查 "parent label"
    freq = Math.log2((map.get(`${parentCmd} ${item.label}`) ?? 0) + 1) * 12
  } else {
    // 命令阶段：查 label
    freq = Math.log2((map.get(item.label) ?? 0) + 1) * 12
  }

  const pop = popularityOf(item.label, parentCmd)

  return fuzzy + freq + pop
}

/**
 * 对候选项列表按综合得分排序（稳定：得分相同保留原字典序）。
 *
 * 用于 command / subcommand 阶段。返回新数组，不改原数组。
 * 平台不兼容项（disabled=true）一律沉到底部，不参与正常排序。
 */
export function rankItems(items: HintItem[], parentCmd?: string): HintItem[] {
  return items
    .map((item) => ({ item, score: rankScore(item, parentCmd) }))
    .sort((a, b) => {
      const ad = a.item.disabled ? 1 : 0
      const bd = b.item.disabled ? 1 : 0
      if (ad !== bd) return ad - bd
      return b.score - a.score || a.item.label.localeCompare(b.item.label)
    })
    .map((x) => ({ ...x.item, score: x.score }))
}
