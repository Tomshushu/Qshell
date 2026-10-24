/**
 * Command Intelligence 补全引擎
 *
 * 流程：用户输入 → 词法分析 → 命令树导航 → 多级补全 → 排序 → 输出 HintItem[]
 *
 * 支持阶段：
 * - command：输入第一个词，匹配 ALL_COMMANDS
 * - subcommand：命令已确定，匹配该层 subcommands（如 git → commit）
 * - param：当前层级已确定，匹配剩余 params（过滤已用），同时识别位置参数
 * - path：上一参数是 requiresValue 或位置参数需要 path 类型，触发路径补全（异步）
 *
 * 多级命令树导航：git → commit → -m，docker → compose → up → -d，任意深度。
 *
 * 复合短选项 -lah、带值参数 -m foo / -mfoo / --name=foo 均能正确识别已用状态。
 */

import { COMMAND_BY_NAME, NETWORK_COMMAND_BY_NAME, ALL_COMMANDS } from '@/data/commands'
import type { CommandSpec, CommandParam, HintItem, HintResult, Platform } from './types'
export type { CommandSpec, CommandParam, HintItem, HintResult, Platform } from './types'
import { fuzzyScore } from './fuzzy-match'
import { findProvider } from './dynamic-completion'
import { rankItems } from './ranking'
import { suggestCorrections, suggestSubcommandCorrections } from './error-correction'
import { disabledReasonFor } from './platform-detector'
import { matchAliases, isKnownAlias } from './alias-map'
import { getStaticValues, getParamStaticValues } from './value-completion'

/** 空结果 */
function emptyResult(input: string): HintResult {
  return { phase: 'command', items: [], commandChain: [], input }
}

/** 判断命令是否为网络设备专属命令 */
function isNetworkCommand(spec: CommandSpec): boolean {
  return !!(spec.platforms && spec.platforms.includes('network'))
}

/** 按平台取命令定义（网络设备优先取 routerCommands，Linux/Unix 取常规命令索引） */
function getCommandSpec(cmd: string, platform: Platform = 'universal'): CommandSpec | undefined {
  if (platform === 'network') {
    return NETWORK_COMMAND_BY_NAME.get(cmd)
  }
  return COMMAND_BY_NAME.get(cmd)
}

/** 是否为路径 token：以 / . ~ 开头，或包含 / （如 ./foo /usr a/b） */
function isPathLikeToken(t: string): boolean {
  if (!t) return false
  return t.startsWith('/') || t.startsWith('.') || t.startsWith('~') || t.includes('/')
}

/**
 * 是否为「容器/远程路径」形态 token：形如 `name:/path` 或 `host:/path`。
 *
 * Docker / kubectl / ssh 等命令支持 `container:path` / `host:path` 复合路径，
 * 此形态应交给路径补全（补全冒号后的路径部分），而非动态容器列表。
 */
function isPrefixedPathToken(t: string): boolean {
  if (!t) return false
  // 必须含冒号且冒号后是路径形态
  const colonIdx = t.indexOf(':')
  if (colonIdx <= 0) return false
  const after = t.slice(colonIdx + 1)
  // 冒号后为空（如 `web:`）也视为路径补全（用户即将输入路径）
  if (!after) return true
  return after.startsWith('/') || after.startsWith('.') || after.startsWith('~') || after.includes('/')
}

/**
 * 切分复合命令行：定位最后一个不在引号内、未被转义的命令分隔符（`|`、`;`、`&`），
 * 返回该分隔符及其后空白组成的 prefix，以及当前正在输入的活动命令段 segment。
 */
function splitLastCommandSegment(input: string): { prefix: string; segment: string } {
  let lastSepEnd = -1
  let q: '"' | "'" | null = null
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (q) {
      if (ch === '\\' && i + 1 < input.length) {
        i++
        continue
      }
      if (ch === q) q = null
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      continue
    }
    if (ch === '|' || ch === ';') {
      lastSepEnd = i + 1
      continue
    }
    if (ch === '&') {
      // 排除 2>&1 / >&2 / <&0 这类文件描述符复制
      const prev = i > 0 ? input[i - 1] : ''
      if (prev !== '>' && prev !== '<') {
        lastSepEnd = i + 1
      }
    }
  }
  if (lastSepEnd < 0) {
    return { prefix: '', segment: input }
  }
  let segStart = lastSepEnd
  while (segStart < input.length && /\s/.test(input[segStart])) {
    segStart++
  }
  return {
    prefix: input.slice(0, segStart),
    segment: input.slice(segStart),
  }
}

/** 定位命令段中第一个不在引号内、未转义的重定向符（`>` 或 `<`）下标 */
function findFirstUnquotedRedirection(str: string): number {
  let q: '"' | "'" | null = null
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (q) {
      if (ch === '\\' && i + 1 < str.length) {
        i++
        continue
      }
      if (ch === q) q = null
      continue
    }
    if (ch === '\\' && i + 1 < str.length) {
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      continue
    }
    if (ch === '>' || ch === '<') {
      return i
    }
  }
  return -1
}

/** 切分命令段中的最后一个裸重定向符（`>` / `>>` / `<`），用于重定向目标路径补全与回填 */
function splitLastRedirection(segment: string): { prefix: string; targetToken: string } | null {
  let lastRedirEnd = -1
  let q: '"' | "'" | null = null
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (q) {
      if (ch === '\\' && i + 1 < segment.length) {
        i++
        continue
      }
      if (ch === q) q = null
      continue
    }
    if (ch === '\\' && i + 1 < segment.length) {
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      continue
    }
    if (ch === '>' || ch === '<') {
      lastRedirEnd = i + 1
    }
  }
  if (lastRedirEnd < 0) return null
  let targetStart = lastRedirEnd
  while (targetStart < segment.length && /\s/.test(segment[targetStart])) {
    targetStart++
  }
  return {
    prefix: segment.slice(0, targetStart),
    targetToken: segment.slice(targetStart),
  }
}

/**
 * 词法分析：把输入行切分为 tokens。
 *
 * 规则：
 * - 引号感知切分：单/双引号内的空格不切分（`-m "fix bug"` 视为 `-m` + `"fix bug"`）
 * - 反斜杠转义：`\ ` 空格、`\"` 引号等保留下一个字符，不当作分隔/闭合
 * - 保留尾部空串以区分"刚输入空格进入下一阶段"和"还在输入当前词"
 * - 遇到裸（不在引号内）的管道 / 分号 / 后台 `&` 则取最后一个分隔符之后的活动命令段
 * - 遇到裸的重定向 `>` `<` 则截断其后内容
 */
export function tokenize(input: string): string[] {
  const { segment } = splitLastCommandSegment(input)
  const trimmed = segment.trimStart()
  if (!trimmed) return []

  // 1. 定位第一个「裸」重定向符（引号内、转义后的不算），截断其后内容
  const cutoff = findFirstUnquotedRedirection(trimmed)
  const seg = cutoff >= 0 ? trimmed.slice(0, cutoff) : trimmed

  // 2. 引号感知切分
  const tokens: string[] = []
  let cur = ''
  let q: '"' | "'" | null = null
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i]
    if (q) {
      cur += ch
      if (ch === '\\' && i + 1 < seg.length) {
        cur += seg[i + 1]
        i++
        continue
      }
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      cur += ch
      continue
    }
    if (ch === '\\' && i + 1 < seg.length) {
      cur += ch
      cur += seg[i + 1]
      i++
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur)
        cur = ''
      }
    } else {
      cur += ch
    }
  }
  if (cur) tokens.push(cur)

  // 输入以空格结尾时保留空串尾巴，用于阶段判定
  if (/\s$/.test(seg) && tokens.length > 0 && tokens[tokens.length - 1] !== '') {
    tokens.push('')
  }
  return tokens
}

/** sudo 带值选项：剥壳时需连带跳过其后的值 token（如 `sudo -u root cmd`） */
const SUDO_VALUE_OPTIONS = new Set([
  '-u', '--user',
  '-g', '--group',
  '-h', '--host',
  '-p', '--prompt',
  '-D', '--chdir',
  '-C', '--close-from',
  '-R', '--chroot',
  '-r', '--role',
  '-t', '--type',
  '-T', '--command-timeout',
])

/**
 * 剥掉前导的「命令修饰前缀」，返回剩余 tokens 与剥掉的数量。
 *
 * 支持两类前缀（可叠加，如 `sudo FOO=bar cmd` 或 `FOO=bar sudo cmd`）：
 * - `sudo`（及其选项，如 `sudo -u root cmd`）
 * - 环境变量赋值 `KEY=value`（如 `FOO=bar cmd`）
 *
 * `sudo systemctl restart` → ['systemctl','restart']，offset=1；
 * `sudo -u root docker ps` → ['docker','ps']，offset=3；
 * `FOO=bar docker ps` → ['docker','ps']，offset=1。
 * 无前缀、或剥完后没有命令时原样返回（offset=0）。
 */
function stripCommandPrefixes(tokens: string[]): { tokens: string[]; offset: number } {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === 'sudo') {
      // 跳过 sudo 及其选项（带值选项连带跳过其值）
      let j = i + 1
      while (j < tokens.length) {
        const s = tokens[j]
        if (!s.startsWith('-')) break
        if (SUDO_VALUE_OPTIONS.has(s)) {
          // 若带值选项的值尚未输入完（j+1 是最后一个正在输入的 token 或越界），
          // 说明用户仍在输入 sudo 选项自身的值（如 sudo -u ro），此时不穿透到子命令
          if (j + 2 >= tokens.length) {
            return { tokens, offset: 0 }
          }
          j += 2 // 选项 + 已完成的值
        } else {
          j += 1
        }
      }
      i = j
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      i += 1 // 环境变量赋值
      continue
    }
    break // 真正的命令
  }
  if (i === 0 || i >= tokens.length) return { tokens, offset: 0 } // 无前缀 / 剥完后无命令
  return { tokens: tokens.slice(i), offset: i }
}

/** 建立 param 名 → CommandParam 的索引（含 short 别名） */
function buildParamIndex(params: CommandParam[]): Map<string, CommandParam> {
  const idx = new Map<string, CommandParam>()
  for (const p of params) {
    idx.set(p.name, p)
    if (p.short) idx.set(p.short, p)
  }
  return idx
}

/** 将参数及其长短别名一并标记为已使用 */
function markParamUsed(used: Set<string>, rawName: string, p?: CommandParam): void {
  used.add(rawName)
  if (p) {
    used.add(p.name)
    if (p.short) used.add(p.short)
  }
}

/**
 * 解析已用参数集合，识别上一个参数是否在等待值。
 *
 * 拆解规则：
 * - --name=foo → --name 已用，有值
 * - --name foo → --name 已用，下个 token 是值
 * - -mfoo → -m 已用，foo 是值
 * - -lah → -l -a -h 已用（组合）
 * - -l → -l 已用
 */
function parseUsedParams(
  tokens: string[],
  params: CommandParam[],
): { used: Set<string>; lastParamNeedsValue: boolean; lastWaitingParam: CommandParam | null } {
  const used = new Set<string>()
  const idx = buildParamIndex(params)
  let lastParamNeedsValue = false
  let lastWaitingParam: CommandParam | null = null

  for (const t of tokens) {
    if (!t) continue
    if (!t.startsWith('-')) {
      // 非选项 token：若上一参数在等值，这是它的值
      if (lastParamNeedsValue) {
        lastParamNeedsValue = false
        lastWaitingParam = null
      }
      continue
    }
    if (t === '-') continue // 单独 - 表示 stdin

    // 长选项
    if (t.startsWith('--')) {
      const eqIdx = t.indexOf('=')
      const name = eqIdx >= 0 ? t.slice(0, eqIdx) : t
      const p = idx.get(name)
      markParamUsed(used, name, p)
      if (p?.requiresValue) {
        lastParamNeedsValue = eqIdx < 0
        lastWaitingParam = eqIdx < 0 ? p : null
      } else {
        lastParamNeedsValue = false
        lastWaitingParam = null
      }
      continue
    }

    // 短选项（含组合 / 粘连值）
    const body = t.slice(1)
    let j = 0
    while (j < body.length) {
      const shortName = '-' + body[j]
      const p = idx.get(shortName)
      markParamUsed(used, shortName, p)
      if (p?.requiresValue) {
        const rest = body.slice(j + 1)
        if (rest.length > 0) {
          // -mfoo 中 foo 是值
          lastParamNeedsValue = false
          lastWaitingParam = null
        } else {
          // -m 后续 token 是值
          lastParamNeedsValue = true
          lastWaitingParam = p
        }
        break
      }
      j++
    }
  }

  return { used, lastParamNeedsValue, lastWaitingParam }
}

/** 用 spec 拼装 usage 字符串 */
function buildUsage(spec: CommandSpec, chain: CommandSpec[]): string {
  if (spec.usage) return spec.usage
  const prefix = chain.map((c) => c.cmd).join(' ')
  const parts: string[] = []
  if (spec.params && spec.params.length > 0) parts.push('[OPTION]...')
  if (spec.positional) {
    for (const p of spec.positional) {
      parts.push(p.repeatable ? `${p.name}...` : p.name)
    }
  }
  if (spec.subcommands && spec.subcommands.length > 0) parts.push('COMMAND')
  return (prefix + ' ' + parts.join(' ')).trim()
}

/**
 * 判断当前 token 是否触发路径补全（用于情况2：位置参数阶段）。
 *
 * `positionalsDone`：已完成的位置参数个数（不含当前正在输入的 token）。
 * 按「当前位置参数」的 type 判断是否 path/file，避免 `chmod` 的第一个位置参数
 * （`<mode>`，非路径）被误判为路径补全。
 */
function shouldTriggerPathCompletion(
  currentToken: string,
  spec: CommandSpec,
  lastParamNeedsValue: boolean,
  positionalsDone: number,
): boolean {
  // 上一个参数在等值：值类型由情况1单独判断
  if (lastParamNeedsValue) return false

  const positionals = spec.positional || []
  // 已完成个数超出范围时取最后一个位置参数（repeatable 语义）
  const currentPositional =
    positionals.length > 0
      ? positionals[Math.min(positionalsDone, positionals.length - 1)]
      : undefined
  const isPathPositional = inferPositionalPath(currentPositional).isPath

  // 空 token（用户刚按空格进入位置参数阶段）：
  // 当前位置参数是 path/file 类型才触发，如 `cat ` 补文件、`cd ` 补目录；
  // 否则不触发（如 `chmod ` 交给静态值补全、`echo ` 不提示）
  if (!currentToken) return isPathPositional

  // token 是路径形态（/ . ~ 开头或含 /）
  if (isPathLikeToken(currentToken)) return true
  // 容器/远程路径形态（如 web:/app）：交路径补全
  if (isPrefixedPathToken(currentToken)) return true
  // 当前 token 不以 - 开头 → 可能是位置参数；若当前位置参数是 path/file 类型则触发
  if (!currentToken.startsWith('-')) return isPathPositional
  return false
}

/**
 * 判断命令是否适用于指定平台。
 *
 * 规则：
 * - 命令无 platforms 字段 → 视为 universal，始终匹配
 * - 命令有 platforms → 包含 universal 或包含目标平台即匹配
 *
 * @param spec 命令定义
 * @param platform 目标平台（来自服务器 OS 探测），缺省为 universal（不过滤）
 */
function matchesPlatform(spec: CommandSpec, platform: Platform): boolean {
  // 当目标是网络设备 (network) 时：实行严格类型隔离模式，
  // 必须明确指定包含了 'network' 的命令才匹配提示，彻底隔离所有 Linux / Unix 命令
  if (platform === 'network') {
    return isNetworkCommand(spec)
  }

  // 非网络设备平台（Linux / Unix / universal）：彻底排除仅限网络设备的命令
  if (isNetworkCommand(spec) && !spec.platforms?.includes('universal')) {
    return false
  }

  if (!spec.platforms || spec.platforms.length === 0) return true
  if (platform === 'universal') return true
  return spec.platforms.includes('universal') || spec.platforms.includes(platform)
}

/**
 * 按提示词（尖括号内容，如 `<file>`）推断路径类型。
 *
 * 采用白名单，避免把 `<shell>` / `<group>` / `<user>` / `<date>` / `<n>` / `<cmd>`
 * 等非路径词误判为路径。
 */
function inferPathKindByWord(raw: string): {
  isPath: boolean
  mode: 'all' | 'dir' | 'file'
} {
  const hint = raw.trim().toLowerCase()
  if (!hint) return { isPath: false, mode: 'all' }

  const m = hint.match(/^<(.+)>$/)
  const word = m ? m[1].trim() : hint

  const dirWords = new Set(['dir', 'directory', 'folder', '目录', '文件夹'])
  const fileWords = new Set(['file', 'filename', 'filepath', '文件'])
  const pathWords = new Set(['path', '路径'])

  if (pathWords.has(word)) return { isPath: true, mode: 'all' }
  if (dirWords.has(word)) return { isPath: true, mode: 'dir' }
  if (fileWords.has(word)) return { isPath: true, mode: 'file' }
  return { isPath: false, mode: 'all' }
}

/**
 * 推断「带值选项」的值是否应触发路径补全，及其过滤模式。
 *
 * 优先取显式 `type`；当 type 缺失（大量选项只写了 valueHint）时，按 valueHint 推断。
 */
function inferParamPath(param: CommandParam | null): {
  isPath: boolean
  mode: 'all' | 'dir' | 'file'
} {
  if (!param) return { isPath: false, mode: 'all' }
  if (param.type === 'path') return { isPath: true, mode: 'all' }
  if (param.type === 'dir') return { isPath: true, mode: 'dir' }
  if (param.type === 'file') return { isPath: true, mode: 'file' }
  return inferPathKindByWord(param.valueHint || '')
}

/**
 * 推断「位置参数」是否应触发路径补全，及其过滤模式。
 *
 * 位置参数的 `name` 形如 `<file>` / `<dir>` / `<path>`；当 `type` 缺失时
 * 按 name（其次 valueHint）推断，修复大量位置参数未标 type 导致的漏触发。
 */
function inferPositionalPath(pos: CommandParam | undefined): {
  isPath: boolean
  mode: 'all' | 'dir' | 'file'
} {
  if (!pos) return { isPath: false, mode: 'all' }
  if (pos.type === 'path') return { isPath: true, mode: 'all' }
  if (pos.type === 'dir') return { isPath: true, mode: 'dir' }
  if (pos.type === 'file') return { isPath: true, mode: 'file' }
  return inferPathKindByWord(pos.valueHint || pos.name || '')
}

/** 通用选项（几乎所有命令都支持） */
const COMMON_OPTIONS: CommandParam[] = [
  { name: '-h', desc: '显示帮助', type: 'flag' },
  { name: '--help', desc: '显示帮助', type: 'flag' },
  { name: '-v', desc: '显示版本', type: 'flag' },
  { name: '--version', desc: '显示版本', type: 'flag' },
]

/**
 * 命令不在库中时的通用回退。
 *
 * 策略：
 * - 当前 token 以 - 开头 → 模糊匹配通用选项（-h/--help/-v/--version）
 * - 当前 token 不以 - 开头 → 不提示（可能是文件名、用户名等任意值）
 *
 * 这样即使用户输入的是冷门命令（不在库中），输入 - 后仍能看到
 * 通用选项提示，避免"完全无反应"的体验。
 */
function buildUnknownCommandFallback(
  input: string,
  tokens: string[],
  cmdName: string,
): HintResult {
  const currentToken = tokens[tokens.length - 1] || ''
  const fallbackSpec: CommandSpec = { cmd: cmdName, desc: '', params: COMMON_OPTIONS }
  const chain: CommandSpec[] = [fallbackSpec]

  // 非 - 开头：不提示
  if (!currentToken.startsWith('-')) {
    return {
      phase: 'param',
      items: [],
      commandChain: chain,
      activeSpec: fallbackSpec,
      input,
    }
  }

  // - 开头：模糊匹配通用选项
  const items: HintItem[] = COMMON_OPTIONS
    .map((p) => ({ p, score: fuzzyScore(currentToken, p.name) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => ({
      kind: 'param' as const,
      label: x.p.name,
      desc: x.p.desc,
      insertText: x.p.name,
      param: x.p,
      score: x.score,
    }))

  return {
    phase: 'param',
    items,
    commandChain: chain,
    activeSpec: fallbackSpec,
    input,
  }
}

/**
 * 主匹配入口
 * @param input 用户当前输入行
 * @param maxItems 最大返回条数
 * @param platform 服务器平台标签，用于过滤发行版专属命令。缺省为 universal（显示全部）
 */
export function matchHints(
  input: string,
  maxItems = 12,
  platform: Platform = 'universal',
  serverId?: string,
): HintResult {
  if (!input) return emptyResult(input)

  // 若当前活动命令段中包含裸重定向符（如 `cat a > b` 或 `echo hi > /tmp/fo`），
  // 重定向符后由 shell 接收文件路径（排除 `2>&1` 这类文件描述符复制）
  const { segment } = splitLastCommandSegment(input)
  const redir = splitLastRedirection(segment)
  if (redir) {
    if (redir.targetToken.startsWith('&')) {
      return { phase: 'param', items: [], commandChain: [], input }
    }
    return {
      phase: 'path',
      items: [],
      commandChain: [],
      expectingPath: true,
      pathFilterMode: 'file',
      input,
    }
  }

  let tokens = tokenize(input)
  if (tokens.length === 0) return emptyResult(input)

  // sudo / 环境变量前缀穿透：`sudo systemctl ...` 视同 `systemctl ...`，
  // `FOO=bar cmd ...` 视同 `cmd ...`，让子命令/参数/动态/路径补全命中真实命令。
  tokens = stripCommandPrefixes(tokens).tokens

  // ── 阶段 1：命令名 ──
  if (tokens.length === 1) {
    const q = tokens[0]
    if (!q) return emptyResult(input)
    // 按平台隔离网络设备命令与 Linux/Unix 命令；Linux 发行版之间不兼容命令以灰色展示（disabled=true）
    const candidateCommands = ALL_COMMANDS.filter((c) =>
      platform === 'network' ? isNetworkCommand(c) : !isNetworkCommand(c),
    )
    const cmdItems: HintItem[] = candidateCommands
      .map((c) => ({ c, score: fuzzyScore(q, c.cmd), disabled: !matchesPlatform(c, platform) }))
      .filter((x) => x.score >= 0)
      // 输入已完整匹配某命令时，从提示中移除该项：
      // 用户已输入完整命令名，无需再提示；仅保留其他前缀匹配项。
      // 例：输入 ls → 过滤掉 ls，仅显示 lsof/lscpu/lsblk 等；
      //     输入 lsof → 过滤后列表为空，不显示提示面板。
      .filter((x) => x.c.cmd !== q)
      .map((x) => ({
        kind: 'command' as const,
        label: x.c.cmd,
        desc: x.c.desc,
        insertText: x.c.cmd,
        category: x.c.category,
        usage: buildUsage(x.c, [x.c]),
        examples: x.c.examples,
        spec: x.c,
        score: x.score,
        disabled: x.disabled || undefined,
        disabledReason: x.disabled
          ? disabledReasonFor(x.c.platforms, platform)
          : undefined,
      }))

    // 别名候选项（ll / la / .. 等，不在命令库中；网络设备不启用 Linux shell 别名）
    const aliasItems: HintItem[] =
      platform === 'network'
        ? []
        : matchAliases(q, 5, serverId)
            .filter((a) => a.name !== q)
            .map((a) => ({
              kind: 'command' as const,
              label: a.name,
              desc: `alias → ${a.expandsTo}`,
              insertText: a.name,
              aliasOf: a.expandsTo,
              score: fuzzyScore(q, a.name),
            }))

    const matched = rankItems([...cmdItems, ...aliasItems]).slice(0, maxItems)

    // 无任何匹配时，尝试「Did you mean」纠错（编辑距离）。
    // 关键：仅当 q 本身不是已知命令/别名时才纠错——
    // 用户输入完整有效命令（如 lscpu）只是被完整匹配过滤掉，
    // 此时 matched 为空属正常，不应误触发纠错（否则 lscpu 会建议 scp）。
    // 别名同理：输入 ll 不应触发纠错。
    let items = matched
    const isKnownCmd =
      Boolean(getCommandSpec(q, platform)) ||
      (platform !== 'network' && isKnownAlias(q, serverId))
    if (items.length === 0 && q.length >= 3 && !isKnownCmd) {
      const corrections = suggestCorrections(q, 3)
        .filter((c) => matchesPlatform(c, platform))
      items = corrections.map((c) => ({
        kind: 'command' as const,
        label: c.cmd,
        desc: `Did you mean? ${c.desc}`,
        insertText: c.cmd,
        category: c.category,
        usage: buildUsage(c, [c]),
        examples: c.examples,
        spec: c,
        isCorrection: true,
      }))
    }
    return { phase: 'command', items, commandChain: [], input }
  }

  // ── 阶段 2+：参数 / 子命令 / 位置参数 ──
  // 沿命令树向下导航：tokens[0] → tokens[1]（如果是子命令）→ ...
  const cmdName = tokens[0]
  const rootSpec = getCommandSpec(cmdName, platform)
  if (!rootSpec) {
    // 命令不在库中：提供通用回退提示（-h/--help/-v/--version），
    // 避免用户输入已知命令却完全无提示
    return buildUnknownCommandFallback(input, tokens, cmdName)
  }

  const chain: CommandSpec[] = [rootSpec]
  let currentSpec: CommandSpec = rootSpec
  let tokenIdx = 1 // 已消费到 tokens[tokenIdx-1]
  let remainingTokens: string[] = tokens.slice(1)

  // 逐层下钻子命令：只要 currentSpec 有 subcommands 且下一个 token 完整匹配某子命令，就进入
  while (currentSpec.subcommands && currentSpec.subcommands.length > 0 && tokenIdx < tokens.length) {
    const nextToken = tokens[tokenIdx]
    // 子命令必须完整匹配（不能是 - 开头，不能是路径）
    if (!nextToken || nextToken.startsWith('-')) break
    const matchedSub = currentSpec.subcommands.find((s) => s.cmd === nextToken)
    if (!matchedSub) break
    chain.push(matchedSub)
    currentSpec = matchedSub
    tokenIdx++
    remainingTokens = tokens.slice(tokenIdx)
  }

  // 当前正在输入的词
  const currentToken = tokens[tokens.length - 1] || ''

  // ── 子命令匹配 ──
  // 触发条件：当前 spec 有 subcommands，且尚未确定子命令
  // 即：第二个 token（chain 长度 1 时 tokens[1]）正在输入且不以 - 开头
  if (
    currentSpec.subcommands &&
    currentSpec.subcommands.length > 0 &&
    chain.length === tokenIdx && // 没在下钻中消费更多
    tokenIdx < tokens.length &&
    !tokens[tokenIdx].startsWith('-')
  ) {
    const q = tokens[tokenIdx]
    const matched = rankItems(
      currentSpec.subcommands
        .map((s) => ({ s, score: fuzzyScore(q, s.cmd) }))
        .filter((x) => x.score >= 0)
        // 子命令完整匹配时同样移除：用户已输入完整子命令名，无需再提示。
        // 例：git commit → 过滤掉 commit，仅显示 commit-tree 等其他前缀匹配项。
        .filter((x) => x.s.cmd !== q)
        .map((x) => ({
          kind: 'subcommand' as const,
          label: x.s.cmd,
          desc: x.s.desc,
          insertText: x.s.cmd,
          usage: buildUsage(x.s, chain),
          examples: x.s.examples,
          spec: x.s,
          score: x.score,
        })),
      // 父命令名，用于查 "git checkout" 这种二级历史频次
      chain[chain.length - 1]?.cmd,
    ).slice(0, maxItems)

    // 无任何匹配时，尝试「Did you mean」纠错（与 command 阶段一致）。
    // 例：git comit → Did you mean commit？
    // 前置判断：q 本身是已知子命令时不纠错（被完整匹配过滤属正常）。
    let items = matched
    const isKnownSub = currentSpec.subcommands.some((s) => s.cmd === q)
    if (items.length === 0 && q.length >= 3 && !isKnownSub) {
      const corrections = suggestSubcommandCorrections(q, currentSpec, 3)
      items = corrections.map((s) => ({
        kind: 'subcommand' as const,
        label: s.cmd,
        desc: `Did you mean? ${s.desc}`,
        insertText: s.cmd,
        usage: buildUsage(s, chain),
        examples: s.examples,
        spec: s,
        isCorrection: true,
      }))
    }
    return {
      phase: 'subcommand',
      items,
      commandChain: chain,
      usage: buildUsage(currentSpec, chain),
      examples: currentSpec.examples,
      activeSpec: currentSpec,
      input,
    }
  }

  // ── 参数值静态补全（快捷时间等）──
  // 当上一个 token 是 --since/--until 等时间参数（在等值）时，提供静态快捷时间。
  // 优先级高于动态补全，避免 `docker logs --since <Tab>` 误弹容器名列表。
  {
    const chainNamesForParam = chain.map((c) => c.cmd)
    const paramStaticVals = getParamStaticValues(
      chainNamesForParam,
      tokens,
      currentToken,
    )
    if (paramStaticVals) {
      const items: HintItem[] = paramStaticVals.map((v) => ({
        kind: 'positional' as const,
        label: v.insertText,
        desc: v.desc,
        insertText: v.insertText,
      }))
      return {
        phase: 'param',
        items,
        commandChain: chain,
        usage: buildUsage(currentSpec, chain),
        examples: currentSpec.examples,
        activeSpec: currentSpec,
        input,
      }
    }
  }

  // ── 参数解析（前置，避免带值选项如 `ssh -i ` / `curl -o ` 被动态补全截胡） ──
  const params = currentSpec.params || []
  const { used, lastParamNeedsValue, lastWaitingParam } = parseUsedParams(
    // 排除最后一个正在输入的 token，避免它被误判为已用
    remainingTokens.slice(0, -1),
    params,
  )

  // ── 动态补全 Provider 触发判定 ──
  // 优先级：path-like token → 路径补全；上一参数在等值（除 journalctl -u）→ 走参数值补全；否则若 provider 命中 → 动态补全。
  if (
    !currentToken.startsWith('-') &&
    !isPathLikeToken(currentToken) &&
    !isPrefixedPathToken(currentToken)
  ) {
    const chainNames = chain.map((c) => c.cmd)
    const provider = findProvider(chainNames, tokens, currentToken)
    if (provider && (!lastParamNeedsValue || provider.id === 'journalctl-units')) {
      return {
        phase: 'dynamic',
        items: [],
        commandChain: chain,
        usage: buildUsage(currentSpec, chain),
        examples: currentSpec.examples,
        activeSpec: currentSpec,
        dynamicProvider: provider,
        tokens,
        currentToken,
        input,
      }
    }
  }

  const ql = currentToken

  // 已完成的位置参数个数（不含当前正在输入的 token），供按位置判断 path/file 类型
  const positionalsDone = remainingTokens
    .slice(0, -1)
    .filter((t) => t && !t.startsWith('-')).length

  // 当前正在填的位置参数（用于推导路径补全过滤模式）
  const positionals = currentSpec.positional || []
  const currentPositional =
    positionals.length > 0
      ? positionals[Math.min(positionalsDone, positionals.length - 1)]
      : undefined
  // dir → 只补目录；file → 只补文件；path/其他 → 全部（type 缺失时按 name/valueHint 推断）
  const positionPathFilterMode = inferPositionalPath(currentPositional).mode

  // 路径补全触发判定（不在这里返回结果，而是标记 expectingPath 让 UI 异步取数）
  const expectingPath = shouldTriggerPathCompletion(
    ql,
    currentSpec,
    lastParamNeedsValue,
    positionalsDone,
  )

  // 情况 1：上一参数在等值，且当前不是 - 开头 → 值位置
  if (lastParamNeedsValue && !ql.startsWith('-')) {
    // 等值参数的类型（显式 type 或 valueHint 推断）决定是否补路径；
    // 非路径值（如 git commit -m <msg>）不提示，避免噪音
    const inferred = inferParamPath(lastWaitingParam)
    // token 本身是路径形态（/ . ~ 开头）也触发，无论参数类型
    // 容器/远程路径形态（web:/app）同样触发
    const tokenIsPathLike = isPathLikeToken(ql) || isPrefixedPathToken(ql)
    const shouldPath = inferred.isPath || tokenIsPathLike
    return {
      phase: shouldPath ? 'path' : 'param',
      items: [],
      commandChain: chain,
      usage: buildUsage(currentSpec, chain),
      examples: currentSpec.examples,
      activeSpec: currentSpec,
      expectingPath: shouldPath,
      pathFilterMode: shouldPath ? inferred.mode : undefined,
      input,
    }
  }

  // 情况 2：位置参数阶段（含空 token，即用户刚按空格）
  // - 空 token + 当前位置参数是 path/file：触发路径补全（如 `cat ` 补文件、`cd ` 补目录）
  // - 非空 token：按原逻辑
  if (!ql.startsWith('-') && (ql || expectingPath)) {
    // 如果是路径形态或位置参数是 path/file 类型，标记 expectingPath
    if (expectingPath) {
      return {
        phase: 'path',
        items: [],
        commandChain: chain,
        usage: buildUsage(currentSpec, chain),
        examples: currentSpec.examples,
        activeSpec: currentSpec,
        expectingPath: true,
        pathFilterMode: positionPathFilterMode,
        input,
      }
    }
    // 位置参数但非 path 类型：不提示
    return {
      phase: 'param',
      items: [],
      commandChain: chain,
      usage: buildUsage(currentSpec, chain),
      examples: currentSpec.examples,
      activeSpec: currentSpec,
      input,
    }
  }

  // 情况 2.5：静态值补全（chmod 模式 / umask 掩码等）
  // 当命令链命中静态值表，且当前在第一位置参数阶段（含空 token，即刚按空格），
  // 直接给出常用取值。currentToken 以 - 开头时仍走情况 3/4 的参数匹配。
  if (!currentToken.startsWith('-')) {
    const chainNames = chain.map((c) => c.cmd)
    const staticVals = getStaticValues(chainNames)
    if (staticVals) {
      // 复用外层已计算的 positionalsDone（不含当前正在输入的 token）
      if (positionalsDone === 0) {
        const lower = currentToken.toLowerCase()
        const valItems: HintItem[] = staticVals
          .filter((v) => !lower || v.insertText.toLowerCase().startsWith(lower))
          .slice(0, maxItems)
          .map((v) => ({
            kind: 'positional' as const,
            label: v.insertText,
            desc: v.desc,
            insertText: v.insertText,
          }))
        return {
          phase: 'param',
          items: valItems,
          commandChain: chain,
          usage: buildUsage(currentSpec, chain),
          examples: currentSpec.examples,
          activeSpec: currentSpec,
          input,
        }
      }
    }
  }

  // 情况 3：组合短选项如 -lah（多字符且非 -- 开头，且主体为纯 ASCII 字母）
  if (ql.startsWith('-') && !ql.startsWith('--') && ql.length > 2 && /^[a-zA-Z]+$/.test(ql.slice(1))) {
    const body = ql.slice(1)
    const firstShortExists = params.some((p) => p.name === '-' + body[0] || p.short === '-' + body[0])
    if (firstShortExists) {
      const usedInCombo = new Set<string>()
      for (const ch of body) usedInCombo.add('-' + ch)
      const items: HintItem[] = params
        .filter((p) => !used.has(p.name) && (!p.short || !used.has(p.short)) && !usedInCombo.has(p.name))
        .filter((p) => /^-[a-zA-Z]$/.test(p.name))
        .map((p) => ({
          kind: 'param' as const,
          label: p.name,
          desc: p.desc,
          insertText: p.name.slice(1), // 组合时只追加字母
          requiresValue: p.requiresValue,
          valueHint: p.valueHint,
          param: p,
        }))
        .slice(0, maxItems)
      return {
        phase: 'param',
        items,
        commandChain: chain,
        usage: buildUsage(currentSpec, chain),
        examples: currentSpec.examples,
        activeSpec: currentSpec,
        input,
      }
    }
  }

  // 情况 4：普通参数匹配（空 token 或 - / -- 前缀，同时支持按中英文描述语义检索如 `-忽略` / `--size`）
  const scoreParam = (query: string, p: CommandParam): number => {
    const nameScore = fuzzyScore(query, p.name)
    const shortScore = p.short ? fuzzyScore(query, p.short) : -1
    const best = Math.max(nameScore, shortScore)
    if (best >= 0) return best
    if (query.startsWith('-')) {
      const kw = query.replace(/^-+/, '').trim().toLowerCase()
      const isCjk = /[^\x00-\x7f]/.test(kw)
      if ((isCjk && kw.length >= 1) || kw.length >= 2) {
        if (
          p.desc?.toLowerCase().includes(kw) ||
          p.valueHint?.toLowerCase().includes(kw)
        ) {
          return 25 - Math.min(10, p.name.length)
        }
      }
    }
    return -1
  }

  const items: HintItem[] = params
    .filter((p) => (!used.has(p.name) && (!p.short || !used.has(p.short))) || p.repeatable)
    .map((p) => ({ p, score: scoreParam(ql, p) }))
    .filter((x) => x.score >= 0)
    .filter((x) => {
      if (!ql) return true
      if (ql === '-') return x.p.name.startsWith('-') && !x.p.name.startsWith('--')
      if (ql === '--') return x.p.name.startsWith('--')
      return true // 已经过 scoreParam 过滤
    })
    .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name))
    .slice(0, maxItems)
    .map((x) => ({
      kind: 'param' as const,
      label: x.p.name,
      desc: x.p.desc,
      insertText: x.p.name,
      requiresValue: x.p.requiresValue,
      valueHint: x.p.valueHint,
      param: x.p,
      score: x.score,
    }))

  return {
    phase: 'param',
    items,
    commandChain: chain,
    usage: buildUsage(currentSpec, chain),
    examples: currentSpec.examples,
    activeSpec: currentSpec,
    expectingPath,
    input,
  }
}

/**
 * 计算单个 token 补全时需要向终端发送的增量字符串：
 * - 若目标文本以已输入 token 为精确前缀（区分大小写），直接追加剩余后缀；
 * - 若为模糊匹配（如 stl → systemctl）、拼写纠错（如 gti → git）或大小写不一致（如 DOC → docker），
 *   先发送退格符（\x7f）擦除已输入的 token，再写入完整的目标文本。
 */
function computeTokenCompletion(typedToken: string, targetText: string): string {
  if (!typedToken) return targetText
  if (targetText.startsWith(typedToken)) {
    return targetText.substring(typedToken.length)
  }
  return '\x7f'.repeat(typedToken.length) + targetText
}

/**
 * 应用补全：根据当前输入和选中的 hint，返回补全后的输入字符串、
 * 需要写入 shell 的增量文本，以及可选的光标左移回退格数（cursorBack）。
 *
 * 关键：newInput 必须与 shell 实际输入行同步，
 * 补全 token 末尾带空格，让随后的 matchHints 进入下一阶段。
 */
export function applyHint(
  input: string,
  hint: HintItem,
): { newInput: string; insertText: string; cursorBack?: number } {
  // 完整命令行补全（历史推荐或马尔可夫转移连招）
  if (hint.kind === 'history' || hint.kind === 'markov') {
    const trimmedInput = input.trimStart()
    const endsWithEmptyQuotes =
      hint.insertText.endsWith('""') || hint.insertText.endsWith("''")
    const hasDoubleSpaceSlot = hint.insertText.includes('  ')
    const trailing = endsWithEmptyQuotes || hasDoubleSpaceSlot ? '' : ' '
    const cursorBack =
      hint.cursorBack ??
      (endsWithEmptyQuotes
        ? 1
        : hasDoubleSpaceSlot
          ? hint.insertText.length - (hint.insertText.indexOf('  ') + 1)
          : undefined)
    if (hint.insertText.startsWith(trimmedInput)) {
      const completion = hint.insertText.slice(trimmedInput.length)
      return {
        newInput: hint.insertText + trailing,
        insertText: completion + trailing,
        ...(cursorBack ? { cursorBack } : {}),
      }
    }
    const erase = '\x7f'.repeat(trimmedInput.length)
    return {
      newInput: hint.insertText + trailing,
      insertText: erase + hint.insertText + trailing,
      ...(cursorBack ? { cursorBack } : {}),
    }
  }

  const { prefix: cmdPrefix, segment } = splitLastCommandSegment(input)
  const redir = splitLastRedirection(segment)
  if (redir) {
    const lastToken = redir.targetToken.trim()
    const isDirPath = hint.kind === 'path' && hint.insertText.endsWith('/')
    const trailing = isDirPath ? '' : ' '
    const newInput = `${cmdPrefix}${redir.prefix}${hint.insertText}${trailing}`
    const completion = computeTokenCompletion(lastToken, hint.insertText) + trailing
    return { newInput, insertText: completion }
  }

  const tokens = tokenize(input)
  const endsWithSpace = /\s$/.test(input)

  if (hint.kind === 'command') {
    // 替换命令词；若有前导管道/分号及 sudo / 环境变量赋值，替换其后那个词并保留全部前缀。
    const { tokens: stripped, offset } = stripCommandPrefixes(tokens)
    const head = tokens.slice(0, offset)
    const rest = tokens.slice(offset + 1).join(' ')
    const sudoPrefix = head.length > 0 ? `${head.join(' ')} ` : ''
    const newInput = rest
      ? `${cmdPrefix}${sudoPrefix}${hint.insertText} ${rest} `
      : `${cmdPrefix}${sudoPrefix}${hint.insertText} `
    const completion = computeTokenCompletion(stripped[0] ?? '', hint.insertText)
    return { newInput, insertText: completion + ' ' }
  }

  // subcommand / param：替换最后一个 token
  const lastToken = tokens[tokens.length - 1] ?? ''
  const head = tokens.slice(0, -1).join(' ')

  // 组合短选项追加：如 -la + h → -lah
  // 注意：insertText 只是字母（如 'h'），不带空格；
  // newInput 也不带尾随空格，让用户可继续组合或手动按空格结束。
  // 若带空格会导致 currentInputRef 与 shell 实际输入不同步。
  const isComboAppend =
    hint.kind === 'param' &&
    lastToken.startsWith('-') &&
    !lastToken.startsWith('--') &&
    lastToken.length > 2
  if (isComboAppend) {
    const combined = lastToken + hint.insertText
    const newInput = head ? `${cmdPrefix}${head} ${combined}` : `${cmdPrefix}${combined}`
    return { newInput, insertText: hint.insertText }
  }

  // 路径补全且目标是目录（insertText 以 '/' 结尾）：
  // 不带尾随空格，让用户能继续输入子路径（如 /usr/lib/ → /usr/lib/lo）
  const isDirPath = hint.kind === 'path' && hint.insertText.endsWith('/')
  if (isDirPath) {
    const newInput = head ? `${cmdPrefix}${head} ${hint.insertText}` : `${cmdPrefix}${hint.insertText}`
    const completion = endsWithSpace
      ? hint.insertText
      : computeTokenCompletion(lastToken, hint.insertText)
    return { newInput, insertText: completion }
  }

  // 其它情况（subcommand / 普通参数 / 文件路径 / 历史）：
  // newInput 末尾带空格，触发下一阶段匹配
  const newInput = head ? `${cmdPrefix}${head} ${hint.insertText} ` : `${cmdPrefix}${hint.insertText} `
  const completion = endsWithSpace
    ? hint.insertText + ' '
    : computeTokenCompletion(lastToken, hint.insertText) + ' '
  return { newInput, insertText: completion }
}
