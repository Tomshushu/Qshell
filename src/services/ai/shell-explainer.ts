/**
 * src/services/ai/shell-explainer.ts
 *
 * 复杂管道与天书指令解析引擎 (Explain Shell Engine)
 *
 * 核心功能：
 * 1. 词法状态机切分：正确识别顶层管道符 `|`，避免单引号/双引号/转义符中的 `|` 误切分；
 * 2. 常见天书指令参数字典：覆盖 awk, sed, find, sort, uniq, grep, xargs, cut, tr 等高频运维工具；
 * 3. 意图嗅探 (Intent Detection)：精准区分用户是想要「指令拆解」还是「故障排查」；
 * 4. 零信任安全分级联动：标注每个步骤是否有破坏性/修改风险。
 */

import { evaluateCommandForExecution } from './command-guard'
import type {
  CommandRiskLevel,
  ShellPipelineStep,
  ShellPipelineExplainResult,
} from '@/types/ai'

/**
 * 判断短参数集合是否包含某字母 (支持短选项合并，例如 -nr 中包含 n 和 r)
 */
export function hasShortFlag(args: string[], char: string): boolean {
  return args.some(
    (a) => a.startsWith('-') && !a.startsWith('--') && a.includes(char),
  )
}

/**
 * 常见天书 Linux 指令与其高频参数字典
 */
export interface ToolFlagDefinition {
  flag: string
  match: (args: string[], segment: string) => boolean
  meaning: string
}

export interface ToolDefinition {
  name: string
  title: string
  action: (args: string[]) => string
  flags: ToolFlagDefinition[]
}

export const SHELL_TOOL_DICTIONARY: Record<string, ToolDefinition> = {
  awk: {
    name: 'awk',
    title: '文本与模式扫描处理',
    action: (args) => {
      const full = args.join(' ')
      if (full.includes('$1') && !full.includes('$2')) return '提取每行第 1 个字段 (如 IP 地址或首列标识)'
      if (full.includes('$2')) return '提取每行指定的列数据并重新排列格式'
      if (full.includes('END')) return '对流经的文本执行聚合汇总统计计算'
      return '按行模式扫描并提取指定列或格式化文本输出'
    },
    flags: [
      { flag: "-F '...'", match: (args, seg) => hasShortFlag(args, 'F') || /-F\s*['"]?/.test(seg), meaning: '指定列与字段的分隔符' },
      { flag: 'print $1', match: (_, seg) => /print\s+\$1\b/.test(seg), meaning: '输出第 1 列字段' },
      { flag: 'print $2', match: (_, seg) => /print\s+\$2\b/.test(seg), meaning: '输出第 2 列字段' },
      { flag: 'print $NF', match: (_, seg) => /print\s+\$NF\b/.test(seg), meaning: '输出每行最后一列字段' },
      { flag: 'NR', match: (_, seg) => /\bNR\b/.test(seg), meaning: '当前记录行号变量' },
      { flag: 'NF', match: (_, seg) => /\bNF\b/.test(seg), meaning: '当前行总列数变量' },
    ],
  },
  sed: {
    name: 'sed',
    title: '流编辑器 (Stream Editor)',
    action: (args) => {
      const full = args.join(' ')
      if (full.includes('s/') || full.includes('s#') || full.includes('s|')) return '对流经文本执行正则搜索与内容替换'
      if (full.includes('/d') || full.endsWith('d')) return '根据模式或行号过滤删除特定行'
      return '对流经文本执行行级过滤、替换或转换处理'
    },
    flags: [
      { flag: 's/old/new/g', match: (_, seg) => /s[/|#](.*?)[/|#]/.test(seg), meaning: '正则全局搜索并将旧文本替换为新文本' },
      { flag: '-i', match: (args) => hasShortFlag(args, 'i'), meaning: '⚠️ 直接修改源文件 (原地写入替换)' },
      { flag: '-e', match: (args) => hasShortFlag(args, 'e'), meaning: '指定要执行的 sed 脚本或表达式' },
      { flag: '-n', match: (args) => hasShortFlag(args, 'n'), meaning: '静默模式，仅输出经模式匹配处理的行' },
    ],
  },
  find: {
    name: 'find',
    title: '递归文件搜索',
    action: (args) => {
      const full = args.join(' ')
      if (full.includes('-exec') && (full.includes('rm') || full.includes('delete'))) {
        return '递归查找匹配文件并直接执行批量删除操作'
      }
      if (full.includes('-exec')) return '递归查找符合条件的文件并对每个文件执行后续指定命令'
      return '在指定目录树下根据名称、时间、大小或类型递归查找文件'
    },
    flags: [
      { flag: '-name', match: (args) => args.includes('-name'), meaning: '按文件名通配模式匹配搜索' },
      { flag: '-type f', match: (_, seg) => /-type\s+f\b/.test(seg), meaning: '仅匹配普通文件 (排除目录与套接字)' },
      { flag: '-type d', match: (_, seg) => /-type\s+d\b/.test(seg), meaning: '仅匹配目录文件夹' },
      { flag: '-mtime +N', match: (args) => args.some((a) => a.startsWith('-mtime')), meaning: '按文件修改时间筛选 (如 +30 表示 30 天以前)' },
      { flag: '-size +N', match: (args) => args.some((a) => a.startsWith('-size')), meaning: '按文件大小筛选 (如 +100M 表示大于 100MB)' },
      { flag: '-exec ... {} \\;', match: (_, seg) => /-exec\b/.test(seg), meaning: '对查找到的每个匹配项作为参数调用执行外部命令' },
      { flag: '-maxdepth N', match: (_, seg) => /-maxdepth\b/.test(seg), meaning: '限制目录向下递归的最大深度' },
      { flag: '-delete', match: (args) => args.includes('-delete'), meaning: '⚠️ 查找到匹配文件后立即直接删除' },
    ],
  },
  sort: {
    name: 'sort',
    title: '文本排序与整理',
    action: (args) => {
      const isNum = hasShortFlag(args, 'n') || args.includes('--numeric-sort')
      const isRev = hasShortFlag(args, 'r') || args.includes('--reverse')
      if (isNum && isRev) return '将输入流按数值大小从大到小进行降序倒序排列'
      if (isRev) return '将输入流文本按字母顺序进行逆序/倒序排列'
      if (isNum) return '将输入流文本按数值大小进行升序排列'
      return '将文本按行进行字典序升序排序 (为后续聚合去重打底)'
    },
    flags: [
      { flag: '-n', match: (args) => hasShortFlag(args, 'n') || args.includes('--numeric-sort'), meaning: '按数值大小 (Numeric) 比较而非 ASCII 字典序' },
      { flag: '-r', match: (args) => hasShortFlag(args, 'r') || args.includes('--reverse'), meaning: '逆序/倒序排列 (Reverse，由大到小)' },
      { flag: '-k', match: (args, seg) => hasShortFlag(args, 'k') || /-k\s*\d+/.test(seg), meaning: '指定按哪一列字段 (Key) 进行排序' },
      { flag: '-u', match: (args) => hasShortFlag(args, 'u') || args.includes('--unique'), meaning: '排序时去除重复行 (Unique)' },
      { flag: '-t', match: (args, seg) => hasShortFlag(args, 't') || /-t\s*['"]?/.test(seg), meaning: '指定列字段分隔符' },
    ],
  },
  uniq: {
    name: 'uniq',
    title: '相邻重复行去重与频次统计',
    action: (args) => {
      if (hasShortFlag(args, 'c') || args.includes('--count')) return '统计每个相邻重复行出现的频次并输出前缀计数值'
      if (hasShortFlag(args, 'd') || args.includes('--repeated')) return '仅输出重复出现过的行记录'
      if (hasShortFlag(args, 'u') || args.includes('--unique')) return '仅输出只出现过 1 次的独一无二行记录'
      return '折叠并去除连续相邻的重复行'
    },
    flags: [
      { flag: '-c', match: (args) => hasShortFlag(args, 'c') || args.includes('--count'), meaning: '计数统计 (Count)，在行首显示出现频次' },
      { flag: '-d', match: (args) => hasShortFlag(args, 'd') || args.includes('--repeated'), meaning: '仅输出重复行 (Duplicates)' },
      { flag: '-u', match: (args) => hasShortFlag(args, 'u') || args.includes('--unique'), meaning: '仅输出唯一未重复的行 (Unique only)' },
      { flag: '-i', match: (args) => hasShortFlag(args, 'i') || args.includes('--ignore-case'), meaning: '比较时忽略大小写 (Ignore case)' },
    ],
  },
  grep: {
    name: 'grep',
    title: '文本正则模式匹配过滤',
    action: (args) => {
      if (hasShortFlag(args, 'v') || args.includes('--invert-match')) return '反向过滤：排除掉所有包含指定特征的行'
      if (hasShortFlag(args, 'c') || args.includes('--count')) return '统计匹配特征的行总数'
      return '按正则模式筛选出匹配指定特征的行文本'
    },
    flags: [
      { flag: '-v', match: (args) => hasShortFlag(args, 'v') || args.includes('--invert-match'), meaning: '反向过滤 (Invert)，排除匹配项' },
      { flag: '-i', match: (args) => hasShortFlag(args, 'i') || args.includes('--ignore-case'), meaning: '忽略大小写 (Ignore case)' },
      { flag: '-E', match: (args) => hasShortFlag(args, 'E') || args.includes('--extended-regexp'), meaning: '启用扩展正则表达式 (Extended Regex)' },
      { flag: '-r / -R', match: (args) => hasShortFlag(args, 'r') || hasShortFlag(args, 'R'), meaning: '递归搜索子目录下所有文件' },
      { flag: '-n', match: (args) => hasShortFlag(args, 'n') || args.includes('--line-number'), meaning: '在输出结果中附带显示行号' },
      { flag: '-C N', match: (args, seg) => hasShortFlag(args, 'C') || /-C\s*\d+/.test(seg), meaning: '输出匹配行的前后上下文关联行' },
    ],
  },
  xargs: {
    name: 'xargs',
    title: '标准输入转命令行参数构建器',
    action: () => '将前一步管道输出的逐行内容转换为参数，传递给后续目标命令批量执行',
    flags: [
      { flag: '-I {}', match: (_, seg) => /-I\s*\S+/.test(seg), meaning: '定义占位符 (每次以一个参数代入该位置)' },
      { flag: '-n N', match: (args, seg) => hasShortFlag(args, 'n') || /-n\s*\d+/.test(seg), meaning: '限制每次命令调用的最大参数个数' },
      { flag: '-P N', match: (args, seg) => hasShortFlag(args, 'P') || /-P\s*\d+/.test(seg), meaning: '多进程并行执行加速 (Parallel)' },
      { flag: '-0', match: (args) => args.includes('-0'), meaning: '以 null (\\0) 字节而非换行符切分输入' },
    ],
  },
  head: {
    name: 'head',
    title: '截取头部数据',
    action: (args) => {
      const match = args.join(' ').match(/-n\s*(\d+)/)
      const count = match ? match[1] : '10'
      return `仅保留前 ${count} 行输出，丢弃后续其余数据流`
    },
    flags: [
      { flag: '-n N', match: (args, seg) => hasShortFlag(args, 'n') || /-n\s*\d+/.test(seg), meaning: '指定截取输出的前 N 行内容' },
    ],
  },
  tail: {
    name: 'tail',
    title: '截取尾部数据 / 实时追踪',
    action: (args) => {
      if (hasShortFlag(args, 'f') || args.includes('--follow')) return '实时持续追踪输出文件新增的尾部内容'
      const match = args.join(' ').match(/-n\s*(\d+)/)
      const count = match ? match[1] : '10'
      return `仅保留末尾最后 ${count} 行输出内容`
    },
    flags: [
      { flag: '-f', match: (args) => hasShortFlag(args, 'f') || args.includes('--follow'), meaning: '持续追加跟踪 (Follow) 模式' },
      { flag: '-n N', match: (args, seg) => hasShortFlag(args, 'n') || /-n\s*\d+/.test(seg), meaning: '指定截取输出的最后 N 行内容' },
    ],
  },
  cat: {
    name: 'cat',
    title: '文件串联读取',
    action: (args) => {
      const file = args.find((a) => !a.startsWith('-'))
      return file ? `读取文件 [${file}] 的完整文本流` : '从标准输入或文件中读取并输出完整文本流'
    },
    flags: [
      { flag: '-n', match: (args) => hasShortFlag(args, 'n'), meaning: '为输出的每一行内容标注行号' },
    ],
  },
  cut: {
    name: 'cut',
    title: '按列切割提取字段',
    action: () => '按指定定界符对每行文本进行分段，并提取特定字段列',
    flags: [
      { flag: '-d', match: (args, seg) => hasShortFlag(args, 'd') || /-d\s*['"]?/.test(seg), meaning: '指定列分隔定界符' },
      { flag: '-f', match: (args, seg) => hasShortFlag(args, 'f') || /-f\s*[0-9,-]+/.test(seg), meaning: '指定要抽取的字段序号或范围 (Field)' },
    ],
  },
  tr: {
    name: 'tr',
    title: '字符转换与删除',
    action: (args) => {
      if (hasShortFlag(args, 'd')) return '从输入文本流中删除指定的目标字符集合'
      if (hasShortFlag(args, 's')) return '将连续多个重复的目标字符压缩为单个字符'
      return '将文本流中的某类字符一对一批量替换为另一类字符'
    },
    flags: [
      { flag: '-d', match: (args) => hasShortFlag(args, 'd'), meaning: '删除指定字符集 (Delete)' },
      { flag: '-s', match: (args) => hasShortFlag(args, 's'), meaning: '压缩连续重复出现的字符 (Squeeze)' },
    ],
  },
  wc: {
    name: 'wc',
    title: '行数与字数统计',
    action: (args) => {
      if (hasShortFlag(args, 'l')) return '计算流经文本的总行数 (Line count)'
      return '统计流经文本的行数、字数和字节数'
    },
    flags: [
      { flag: '-l', match: (args) => hasShortFlag(args, 'l'), meaning: '仅输出行数 (Lines)' },
      { flag: '-w', match: (args) => hasShortFlag(args, 'w'), meaning: '仅输出单词数 (Words)' },
      { flag: '-c', match: (args) => hasShortFlag(args, 'c'), meaning: '仅输出字节数 (Bytes)' },
    ],
  },
}

/**
 * 管道切分状态机：安全跳过引号与转义符
 */
export function splitPipelineSegments(rawCommand: string): string[] {
  const trimmed = rawCommand.trim()
  if (!trimmed) return []

  const segments: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let isEscaped = false

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]

    if (isEscaped) {
      current += char
      isEscaped = false
      continue
    }

    if (char === '\\') {
      current += char
      isEscaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      current += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      current += char
      continue
    }

    // 只有在非引号包裹时，| 才是真正的 Shell 管道符
    if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      // 避免 || 逻辑或操作符
      if (trimmed[i + 1] === '|') {
        current += '||'
        i++
        continue
      }
      segments.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    segments.push(current.trim())
  }

  return segments.filter(Boolean)
}

/**
 * 命令行参数简单分词器
 */
export function tokenizeCommandLine(cmdSegment: string): { program: string; args: string[] } {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmdSegment.length; i++) {
    const char = cmdSegment[i]
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      current += char
      escaped = true
      continue
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      current += char
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      current += char
      continue
    }
    if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)

  if (tokens.length === 0) {
    return { program: '', args: [] }
  }

  // 处理可能的前缀环境变量赋值 (如 LC_ALL=C sort)
  let programIdx = 0
  while (programIdx < tokens.length && tokens[programIdx].includes('=') && !tokens[programIdx].startsWith('-')) {
    programIdx++
  }
  if (programIdx >= tokens.length) programIdx = 0

  const program = tokens[programIdx] || ''
  const args = [...tokens.slice(0, programIdx), ...tokens.slice(programIdx + 1)]
  return { program, args }
}

/**
 * 本地规则库解析单个管道步骤
 */
export function explainSingleStep(
  segment: string,
  stepIndex: number,
  totalSteps: number,
): ShellPipelineStep {
  const { program, args } = tokenizeCommandLine(segment)
  const baseProgram = program.toLowerCase().replace(/^.*\//, '')
  const toolDef = SHELL_TOOL_DICTIONARY[baseProgram]

  // 1. 安全评级检测
  const guardDecision = evaluateCommandForExecution(segment)
  const riskLevel: CommandRiskLevel = guardDecision.riskLevel
  const riskReason = guardDecision.reason

  // 2. 提取参数说明
  const flagsExplanation: Array<{ flag: string; meaning: string }> = []
  if (toolDef) {
    for (const flagDef of toolDef.flags) {
      if (flagDef.match(args, segment)) {
        flagsExplanation.push({ flag: flagDef.flag, meaning: flagDef.meaning })
      }
    }
  }

  // 3. 通俗动作解析
  let actionDescription = ''
  if (toolDef) {
    actionDescription = toolDef.action(args)
  } else if (segment.includes('>') && !segment.includes('>>')) {
    actionDescription = '重定向写入文件 (⚠️ 会覆盖原文件内容)'
  } else if (segment.includes('>>')) {
    actionDescription = '重定向追加写入文件尾部'
  } else {
    actionDescription = `调用系统工具 [${program}] 执行特定运维处理任务`
  }

  // 4. 数据流转说明
  let dataFlowDescription = ''
  if (stepIndex === 1) {
    dataFlowDescription = '📥 初始输入数据流'
  } else if (stepIndex === totalSteps) {
    dataFlowDescription = '🎯 最终格式化结果输出'
  } else {
    dataFlowDescription = `🔄 管道中间过渡数据流 (Step ${stepIndex - 1} ➔ Step ${stepIndex})`
  }

  return {
    stepIndex,
    rawCommand: segment,
    program,
    args,
    actionDescription,
    flagsExplanation,
    dataFlowDescription,
    riskLevel,
    riskReason: riskLevel !== 'safe' ? riskReason : undefined,
  }
}

/**
 * 完整指令解析引擎入口 (支持单命令与多段管道)
 */
export function explainShellCommand(rawCommand: string): ShellPipelineExplainResult {
  const trimmed = rawCommand.trim()
  const segments = splitPipelineSegments(trimmed)
  const isPipeline = segments.length > 1

  const steps: ShellPipelineStep[] = segments.map((seg, idx) =>
    explainSingleStep(seg, idx + 1, segments.length),
  )

  const hasDestructiveRisk = steps.some(
    (s) => s.riskLevel === 'dangerous' || s.riskLevel === 'blocked',
  )

  // 综合业务总结
  let summary = ''
  if (isPipeline) {
    const firstProg = steps[0]?.program || '数据源'
    const lastProg = steps[steps.length - 1]?.program || '终端'
    summary = `复合管道流水线 (共 ${steps.length} 步)：从 [${firstProg}] 获取输入，经过多级流处理，最终输出至 [${lastProg}]。`
    if (trimmed.includes('uniq -c') && trimmed.includes('sort')) {
      summary = `数据频次统计排行流水线 (共 ${steps.length} 步)：提取关键字段并按出现频次降序统计 TOP 结果。`
    } else if (trimmed.includes('find') && (trimmed.includes('-exec') || trimmed.includes('-delete'))) {
      summary = `递归文件检索与批量操作流水线 (共 ${steps.length} 步)：检索匹配的文件并对目标执行批量命令。`
    }
  } else {
    summary = steps[0]?.actionDescription || '执行单条系统指令。'
  }

  return {
    fullCommand: trimmed,
    summary,
    isPipeline,
    hasDestructiveRisk,
    steps,
  }
}

/**
 * 意图嗅探器 (Intent Detector)
 * 精准区分用户的输入是想要「指令拆解 (Explain)」还是「故障诊断排查 (Diagnose)」
 */
export type DetectedIntentType = 'explain_shell' | 'diagnose' | 'general'

export interface IntentDetectionResult {
  intent: DetectedIntentType
  confidence: number // 0 ~ 1
  commandCandidate?: string
  reason: string
}

const EXPLAIN_KEYWORDS = [
  '解释',
  '拆解',
  '解析',
  '什么意思',
  '怎么理解',
  '看不懂',
  'explain',
  'how it works',
  'parse',
  '/explain',
  '/parse',
  '/拆解',
]

const DIAGNOSE_KEYWORDS = [
  '报错',
  '排查',
  '诊断',
  '定位',
  '为什么失败',
  '挂了',
  '死机',
  '内存爆了',
  'cpu飙高',
  '连接超时',
  'timeout',
  'error',
  'failed',
  'exception',
  'crash',
]

const LOG_FINGERPRINT_REGEX =
  /(?:Traceback\s+\(most\s+recent\s+call\s+last\)|\bException:\b|\bError:\s+|\bfailed\s+with\s+exit\s+code\b|\[emerg\]|\[crit\]|\[error\]|\bstatus\s+5\d{2}\b|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2})/i

const SHELL_COMMAND_PREFIXES = [
  'cat',
  'awk',
  'sed',
  'grep',
  'egrep',
  'rg',
  'find',
  'sort',
  'uniq',
  'xargs',
  'head',
  'tail',
  'cut',
  'tr',
  'wc',
  'tar',
  'curl',
  'wget',
  'ps',
  'netstat',
  'ss',
  'lsof',
  'systemctl',
  'docker',
  'kubectl',
  'iptables',
  'journalctl',
]

export function isLikelyCommandCandidate(rawCandidate: string): boolean {
  if (!rawCandidate) return false
  const trimmed = rawCandidate.trim()
  if (!trimmed || trimmed.length > 500) return false

  // 1. 若包含较多汉字，绝非可执行 Shell 命令行
  const chineseChars = trimmed.match(/[\u4e00-\u9fa5]/g)
  if (chineseChars && chineseChars.length > 4) return false

  // 2. 若命中日志/报错堆栈/时间戳特征，绝非纯命令
  if (LOG_FINGERPRINT_REGEX.test(trimmed)) return false

  // 3. 检查是否为复合管道 (包含未转义管道符 |)
  const segments = splitPipelineSegments(trimmed)
  if (segments.length > 1) {
    const firstProg = segments[0].split(/\s+/)[0]?.toLowerCase().replace(/^.*\//, '') || ''
    if (SHELL_COMMAND_PREFIXES.includes(firstProg) || /^[a-zA-Z0-9_.-]+$/.test(firstProg)) {
      return true
    }
  }

  // 4. 检查单条命令是否以知名 Linux 工具开头
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/^.*\//, '') || ''
  if (SHELL_COMMAND_PREFIXES.includes(firstWord)) {
    return true
  }

  // 5. 检查是否包含经典命令行 Flag 参数 (如 -rf, -type f, --help 等)
  if (/^[a-zA-Z0-9_.-]+\s+-[a-zA-Z0-9-]/.test(trimmed)) {
    return true
  }

  return false
}

export function detectUserIntent(inputText: string): IntentDetectionResult {
  const text = inputText.trim()
  if (!text) {
    return { intent: 'general', confidence: 0, reason: '空输入' }
  }

  const lower = text.toLowerCase()

  // 1. 显式 Slash 指令最高优先级
  if (text.startsWith('/explain ') || text.startsWith('/拆解 ') || text.startsWith('/parse ')) {
    const cmd = text.replace(/^\/(?:explain|拆解|parse)\s+/, '').trim()
    return {
      intent: 'explain_shell',
      confidence: 1.0,
      commandCandidate: cmd,
      reason: '匹配到显式拆解指令前缀',
    }
  }

  // 2. 故障诊断与报错特征最高优先级拦截 (哪怕用户问"这是什么意思"，只要关于报错/日志，一律进排查)
  const hasDiagnoseKeyword = DIAGNOSE_KEYWORDS.some((kw) => lower.includes(kw))
  const hasLogFingerprint = LOG_FINGERPRINT_REGEX.test(text)

  if (hasDiagnoseKeyword || hasLogFingerprint) {
    return {
      intent: 'diagnose',
      confidence: 0.95,
      reason: '文本包含故障排查关键词或日志报错特征，优先路由至运维排查',
    }
  }

  // 3. 提取潜在命令候选 (优先从代码块、引号或冒号后截取)
  const codeBlockMatch = text.match(/```(?:bash|sh|shell)?\s*([\s\S]*?)```/)
  const candidateFromCode = codeBlockMatch ? codeBlockMatch[1].trim() : ''
  const candidate = candidateFromCode || extractLikelyCommand(text)

  // 4. 指令拆解意图匹配：必须同时满足「动词意图」且「候选内容真实符合 Shell 命令行形态」
  const hasExplainKeyword = EXPLAIN_KEYWORDS.some((kw) => lower.includes(kw))
  const isCommandValid = isLikelyCommandCandidate(candidate)

  if (hasExplainKeyword && isCommandValid) {
    return {
      intent: 'explain_shell',
      confidence: 0.95,
      commandCandidate: candidate,
      reason: '用户提问包含拆解动词且提取到有效 Shell 指令候选',
    }
  }

  // 5. 纯命令直接粘贴 (无任何自然语言修饰的裸管道命令)
  const isDirectPipedCommand = isLikelyCommandCandidate(text) && splitPipelineSegments(text).length > 1
  if (isDirectPipedCommand) {
    return {
      intent: 'explain_shell',
      confidence: 0.9,
      commandCandidate: text,
      reason: '直接粘贴的多段复合管道指令',
    }
  }

  return {
    intent: 'general',
    confidence: 0.5,
    reason: '普通提问或交互问答',
  }
}

/**
 * 从可能包含自然语言提问的文本中抽离真实的 Shell 命令
 */
function extractLikelyCommand(text: string): string {
  // 如果有冒号后跟命令，例如 "请解释命令: awk '{print $1}' ..."
  const colonMatch = text.match(/[:：]\s*([\w./-]+[\s\S]*)$/)
  if (colonMatch && colonMatch[1]) {
    return colonMatch[1].trim()
  }
  // 提取单引号或双引号包裹的长命令
  const quoteMatch = text.match(/`([^`]+)`/)
  if (quoteMatch && quoteMatch[1]) {
    return quoteMatch[1].trim()
  }
  return text
}
