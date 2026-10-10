export interface HighlightRule {
  id: string
  name: string
  regex: string
  color: string
  enabled: boolean
}

// ESC 控制字符：运行时构造正则/字符串，避免正则字面量中出现控制字符
const ESC = String.fromCharCode(0x1b)
const ANSI_ESCAPE_RE = new RegExp(`(${ESC}\\[[0-9;]*[a-zA-Z])`, "g")

export function hexToAnsi(hex: string): string {
  const cleanHex = hex.replace('#', '')
  let r = 0, g = 0, b = 0
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16) || 0
    g = parseInt(cleanHex[1] + cleanHex[1], 16) || 0
    b = parseInt(cleanHex[2] + cleanHex[2], 16) || 0
  } else if (cleanHex.length >= 6) {
    r = parseInt(cleanHex.substring(0, 2), 16) || 0
    g = parseInt(cleanHex.substring(2, 4), 16) || 0
    b = parseInt(cleanHex.substring(4, 6), 16) || 0
  }
  return `${ESC}[38;2;${r};${g};${b}m`
}

interface CachedRule {
  regexStr: string
  color: string
  compiledRegex: RegExp
  ansiColor: string
}

const ruleCache = new Map<string, CachedRule>()

export function highlightKeywords(
  text: string,
  enabled: boolean,
  rules: HighlightRule[]
): string {
  if (!enabled || !text || !rules || rules.length === 0) return text

  // D3：对大块数据（> 50KB）跳过高亮，避免同步正则处理阻塞主线程。
  // 终端实时输出通常单次远小于此阈值；历史回放场景偶尔超限，跳过高亮不影响可读性。
  const HIGHLIGHT_SKIP_THRESHOLD = 50 * 1024
  if (text.length > HIGHLIGHT_SKIP_THRESHOLD) return text

  // 将 ANSI 转义字符序列和普通文本切割开，只处理偶数索引（普通文本）
  const parts = text.split(ANSI_ESCAPE_RE)

  // 预编译启用的高亮规则，提升渲染性能
  const compiledRules: { regex: RegExp; ansiColor: string }[] = []

  for (const r of rules) {
    if (!r.enabled || !r.regex) continue

    const cacheKey = r.id
    const cached = ruleCache.get(cacheKey)

    if (cached && cached.regexStr === r.regex && cached.color === r.color) {
      compiledRules.push({ regex: cached.compiledRegex, ansiColor: cached.ansiColor })
    } else {
      try {
        const compiledRegex = new RegExp(r.regex, 'gi')
        const ansiColor = hexToAnsi(r.color)
        ruleCache.set(cacheKey, {
          regexStr: r.regex,
          color: r.color,
          compiledRegex,
          ansiColor,
        })
        compiledRules.push({ regex: compiledRegex, ansiColor })
      } catch (e) {
        // 静默处理，或者仅输出一次，避免刷屏
        console.warn(`[Highlighter] 无效的正则表达式 "${r.regex}":`, e)
      }
    }
  }

  const ansiReset = '\x1b[39m' // 仅重置前景色，保留加粗、底色等其他 ANSI 样式

  for (let i = 0; i < parts.length; i += 2) {
    let segment = parts[i]
    if (!segment) continue

    // 依次应用所有高亮匹配规则，$& 表示匹配到的原始子串
    for (const rule of compiledRules) {
      segment = segment.replace(rule.regex, `${rule.ansiColor}$&${ansiReset}`)
    }

    parts[i] = segment
  }

  return parts.join('')
}
