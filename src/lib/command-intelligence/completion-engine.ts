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

import { COMMAND_BY_NAME, ALL_COMMANDS } from '@/data/commands'
import type { CommandSpec, CommandParam, HintItem, HintResult, Platform } from './types'
export type { CommandSpec, CommandParam, HintItem, HintResult, Platform } from './types'
import { fuzzyScore } from './fuzzy-match'
import { findProvider } from './dynamic-completion'
import { rankItems } from './ranking'
import { suggestCorrections, suggestSubcommandCorrections } from './error-correction'
import { disabledReasonFor } from './platform-detector'
import { matchAliases, isKnownAlias } from './alias-map'
import { getStaticValues } from './value-completion'

/** 空结果 */
function emptyResult(input: string): HintResult {
  return { phase: 'command', items: [], commandChain: [], input }
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
 * 词法分析：把输入行切分为 tokens。
 *
 * 规则：
 * - 按空格切分
 * - 保留尾部空串以区分"刚输入空格进入下一阶段"和"还在输入当前词"
 * - 识别管道 / 分号 / 重定向符，遇到则停止提示（交还给 shell）
 */
function tokenize(input: string): string[] {
  const trimmed = input.trimStart()
  if (!trimmed) return []
  // 管道/分号/重定向之后不提示，简化处理
  if (/[|;&]/.test(trimmed)) {
    // 取第一个分隔符前的部分
    const idx = trimmed.search(/[|;&]/)
    if (idx >= 0) return tokenize(trimmed.slice(0, idx))
  }

  const tokens = trimmed.split(/\s+/)
  // 输入以空格结尾时保留空串尾巴，用于阶段判定
  if (/\s$/.test(input) && tokens[tokens.length - 1] !== '') {
    tokens.push('')
  }
  return tokens
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
      used.add(name)
      const p = idx.get(name)
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
      used.add(shortName)
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

/** 判断当前 token 是否触发路径补全（用于情况2：位置参数阶段） */
function shouldTriggerPathCompletion(
  currentToken: string,
  spec: CommandSpec,
  lastParamNeedsValue: boolean,
): boolean {
  if (!currentToken) return false
  // token 是路径形态（/ . ~ 开头或含 /）
  if (isPathLikeToken(currentToken)) return true
  // 容器/远程路径形态（如 web:/app）：交路径补全
  if (isPrefixedPathToken(currentToken)) return true
  // 上一个参数在等值：值类型由情况1单独判断，这里直接返回 false
  if (lastParamNeedsValue) return false
  // 当前 token 不以 - 开头且非空 → 可能是位置参数；
  // 若该位置参数是 path/file 类型，触发路径补全
  if (!currentToken.startsWith('-') && spec.positional) {
    if (spec.positional.some((p) => p.type === 'path' || p.type === 'file')) {
      return true
    }
  }
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
    return !!(spec.platforms && spec.platforms.includes('network'))
  }

  if (!spec.platforms || spec.platforms.length === 0) return true
  if (platform === 'universal') return true
  return spec.platforms.includes('universal') || spec.platforms.includes(platform)
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
export function matchHints(input: string, maxItems = 12, platform: Platform = 'universal'): HintResult {
  if (!input) return emptyResult(input)

  const tokens = tokenize(input)
  if (tokens.length === 0) return emptyResult(input)

  // ── 阶段 1：命令名 ──
  if (tokens.length === 1) {
    const q = tokens[0]
    // 命令库候选项（含平台不兼容项，灰色展示）
    const cmdItems: HintItem[] = ALL_COMMANDS
      // 不再按平台硬过滤：不兼容命令以灰色展示（disabled=true），让用户感知而非隐藏
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

    // 别名候选项（ll / la / .. 等，不在命令库中）
    const aliasItems: HintItem[] = matchAliases(q, 5)
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
    const isKnownCmd = COMMAND_BY_NAME.has(q) || isKnownAlias(q)
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
  const rootSpec = COMMAND_BY_NAME.get(cmdName)
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

  // ── 动态补全 Provider 触发判定 ──
  // 优先级：path-like token → 路径补全；否则若 provider 命中 → 动态补全。
  // 路径形态 token（/ . ~ 开头或含 /）交给路径补全，避免 `docker exec /usr/bin`
  // 时错误弹出容器列表。
  // 容器/远程路径形态（如 `web:/app`、`host:/path`）同样交路径补全，
  // 避免 `docker cp web:/app<Tab>` 时误弹容器列表。
  // currentToken 以 - 开头时是选项输入，不走动态补全。
  // 空 token（用户刚按空格进入值位置）允许触发，例如 `docker exec <Tab>`。
  if (
    !currentToken.startsWith('-') &&
    !isPathLikeToken(currentToken) &&
    !isPrefixedPathToken(currentToken)
  ) {
    const chainNames = chain.map((c) => c.cmd)
    const provider = findProvider(chainNames, tokens, currentToken)
    if (provider) {
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

  // ── 参数匹配 ──
  const params = currentSpec.params || []
  const { used, lastParamNeedsValue, lastWaitingParam } = parseUsedParams(
    // 排除最后一个正在输入的 token，避免它被误判为已用
    remainingTokens.slice(0, -1),
    params,
  )

  const ql = currentToken

  // 路径补全触发判定（不在这里返回结果，而是标记 expectingPath 让 UI 异步取数）
  const expectingPath = shouldTriggerPathCompletion(
    ql,
    currentSpec,
    lastParamNeedsValue,
  )

  // 情况 1：上一参数在等值，且当前不是 - 开头 → 值位置
  if (lastParamNeedsValue && ql && !ql.startsWith('-')) {
    // 仅当等值的参数类型是 path/file 时才触发路径补全；
    // 否则（如 git commit -m <msg>）不提示，避免噪音
    const isPathValue =
      !!lastWaitingParam &&
      (lastWaitingParam.type === 'path' || lastWaitingParam.type === 'file')
    // token 本身是路径形态（/ . ~ 开头）也触发，无论参数类型
    // 容器/远程路径形态（web:/app）同样触发
    const tokenIsPathLike = isPathLikeToken(ql) || isPrefixedPathToken(ql)
    const shouldPath = isPathValue || tokenIsPathLike
    return {
      phase: shouldPath ? 'path' : 'param',
      items: [],
      commandChain: chain,
      usage: buildUsage(currentSpec, chain),
      examples: currentSpec.examples,
      activeSpec: currentSpec,
      expectingPath: shouldPath,
      input,
    }
  }

  // 情况 2：当前 token 不以 - 开头且非空 → 可能是位置参数
  if (ql && !ql.startsWith('-')) {
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
      // 已完成的位置参数个数（不含当前正在输入的 token）
      const positionalsDone = remainingTokens
        .slice(0, -1)
        .filter((t) => t && !t.startsWith('-')).length
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

  // 情况 3：组合短选项如 -lah（多字符且非 -- 开头）
  if (ql.startsWith('-') && !ql.startsWith('--') && ql.length > 2) {
    const body = ql.slice(1)
    const usedInCombo = new Set<string>()
    for (const ch of body) usedInCombo.add('-' + ch)
    const items: HintItem[] = params
      .filter((p) => !used.has(p.name) && !usedInCombo.has(p.name))
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

  // 情况 4：普通参数匹配（空 token 或 - / -- 前缀）
  const items: HintItem[] = params
    .filter((p) => !used.has(p.name) || p.repeatable)
    .map((p) => ({ p, score: fuzzyScore(ql, p.name) }))
    .filter((x) => x.score >= 0)
    .filter((x) => {
      if (!ql) return true
      if (ql === '-') return x.p.name.startsWith('-') && !x.p.name.startsWith('--')
      if (ql === '--') return x.p.name.startsWith('--')
      return true // 已经过 fuzzyScore 过滤
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
 * 应用补全：根据当前输入和选中的 hint，返回补全后的输入字符串
 * 以及需要写入 shell 的增量文本。
 *
 * 关键：newInput 必须与 shell 实际输入行同步，
 * 补全 token 末尾带空格，让随后的 matchHints 进入下一阶段。
 */
export function applyHint(
  input: string,
  hint: HintItem,
): { newInput: string; insertText: string } {
  const tokens = tokenize(input)
  const endsWithSpace = /\s$/.test(input)

  if (hint.kind === 'command') {
    // 替换第一个 token
    const rest = tokens.slice(1).join(' ')
    const newInput = rest ? `${hint.insertText} ${rest} ` : `${hint.insertText} `
    const completion = hint.insertText.substring(tokens[0]?.length ?? 0)
    return { newInput, insertText: completion + ' ' }
  }

  // 完整命令行补全（历史推荐或马尔可夫转移连招）
  if (hint.kind === 'history' || hint.kind === 'markov') {
    const trimmedInput = input.trimStart()
    if (hint.insertText.toLowerCase().startsWith(trimmedInput.toLowerCase())) {
      const completion = hint.insertText.slice(trimmedInput.length)
      const trailing = hint.insertText.endsWith('""') || hint.insertText.endsWith("''") ? '' : ' '
      return {
        newInput: hint.insertText + trailing,
        insertText: completion + trailing,
      }
    }
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
    const newInput = head ? `${head} ${combined}` : combined
    return { newInput, insertText: hint.insertText }
  }

  // 路径补全且目标是目录（insertText 以 '/' 结尾）：
  // 不带尾随空格，让用户能继续输入子路径（如 /usr/lib/ → /usr/lib/lo）
  const isDirPath = hint.kind === 'path' && hint.insertText.endsWith('/')
  if (isDirPath) {
    const newInput = head ? `${head} ${hint.insertText}` : hint.insertText
    const completion = endsWithSpace
      ? hint.insertText
      : hint.insertText.substring(lastToken.length)
    return { newInput, insertText: completion }
  }

  // 其它情况（subcommand / 普通参数 / 文件路径 / 历史）：
  // newInput 末尾带空格，触发下一阶段匹配
  const newInput = head ? `${head} ${hint.insertText} ` : `${hint.insertText} `
  const completion = endsWithSpace
    ? hint.insertText + ' '
    : hint.insertText.substring(lastToken.length) + ' '
  return { newInput, insertText: completion }
}
