export type ReplayFormat = 'asciicast-v2' | 'qshell-jsonl' | 'plain-log'

export interface ReplayFrame {
  /** 经可选静默裁剪后的回放时间戳（毫秒，单调递增） */
  timeMs: number
  /** 原始录制时间戳（毫秒） */
  rawTimeMs: number
  type: 'output' | 'resize'
  data?: string
  cols?: number
  rows?: number
}

export interface ParsedSessionReplay {
  format: ReplayFormat
  title?: string
  cols: number
  rows: number
  durationMs: number
  frames: ReplayFrame[]
}

export interface ParseReplayOptions {
  /** 最大单段静默时长（毫秒）；传入 0 或 undefined 表示不裁剪 */
  maxIdleMs?: number
  /** Qshell JSONL 伴生分卷文件原始字节（part 编号 -> Uint8Array） */
  partFiles?: Record<number, Uint8Array>
}

/**
 * 从 Qshell `.session.jsonl` 索引中提取关联的分卷日志文件名（part 1 -> firstPart，part N -> file）。
 */
export function extractQshellPartFilenames(rawText: string): Map<number, string> {
  const parts = new Map<number, string>()
  const lines = rawText.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const evt = JSON.parse(trimmed) as Record<string, unknown>
      if (!evt || typeof evt !== 'object') continue
      if (evt.type === 'session_start' && typeof evt.firstPart === 'string' && evt.firstPart.trim()) {
        parts.set(1, evt.firstPart.trim())
      } else if (
        evt.type === 'part' &&
        typeof evt.part === 'number' &&
        typeof evt.file === 'string' &&
        evt.file.trim()
      ) {
        parts.set(evt.part, evt.file.trim())
      }
    } catch {
      // ignore invalid line
    }
  }
  return parts
}

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

function applyIdleClamp(rawFrames: ReplayFrame[], maxIdleMs?: number): ReplayFrame[] {
  if (rawFrames.length === 0) return []
  const cap = typeof maxIdleMs === 'number' && maxIdleMs > 0 ? maxIdleMs : Infinity
  let accTime = 0
  let prevRaw = rawFrames[0].rawTimeMs
  return rawFrames.map((f, idx) => {
    if (idx > 0) {
      const delta = Math.max(0, f.rawTimeMs - prevRaw)
      accTime += Math.min(delta, cap)
      prevRaw = f.rawTimeMs
    }
    return {
      ...f,
      timeMs: accTime,
    }
  })
}

function tryParseAsciicastV2(lines: string[], options?: ParseReplayOptions): ParsedSessionReplay | null {
  if (lines.length === 0) return null
  let header: Record<string, unknown>
  try {
    const parsed = JSON.parse(lines[0])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (parsed.version !== 2) return null
    header = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const cols =
    typeof header.width === 'number' && header.width >= 20 ? Math.floor(header.width) : DEFAULT_COLS
  const rows =
    typeof header.height === 'number' && header.height >= 5 ? Math.floor(header.height) : DEFAULT_ROWS
  const title = typeof header.title === 'string' && header.title.trim() ? header.title.trim() : undefined

  const rawFrames: ReplayFrame[] = []
  for (let i = 1; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i])
      if (!Array.isArray(entry) || entry.length < 3) continue
      const timeSec = Number(entry[0])
      const eventType = String(entry[1])
      const payload = entry[2]
      if (!Number.isFinite(timeSec) || timeSec < 0) continue
      const rawTimeMs = Math.round(timeSec * 1000)

      if (eventType === 'o' && typeof payload === 'string') {
        rawFrames.push({ timeMs: rawTimeMs, rawTimeMs, type: 'output', data: payload })
      } else if (eventType === 'r' && typeof payload === 'string') {
        const [cStr, rStr] = payload.split('x')
        const c = parseInt(cStr, 10)
        const r = parseInt(rStr, 10)
        if (Number.isFinite(c) && Number.isFinite(r) && c >= 20 && r >= 5) {
          rawFrames.push({ timeMs: rawTimeMs, rawTimeMs, type: 'resize', cols: c, rows: r })
        }
      }
    } catch {
      // skip malformed line
    }
  }

  const frames = applyIdleClamp(rawFrames, options?.maxIdleMs)
  const durationMs = frames.length > 0 ? frames[frames.length - 1].timeMs : 0
  return { format: 'asciicast-v2', title, cols, rows, durationMs, frames }
}

function tryParseQshellJsonl(lines: string[], options?: ParseReplayOptions): ParsedSessionReplay | null {
  if (lines.length === 0) return null
  let firstObj: Record<string, unknown>
  try {
    const parsed = JSON.parse(lines[0])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (parsed.v !== 1 || typeof parsed.type !== 'string' || typeof parsed.atMs !== 'number') {
      return null
    }
    firstObj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  let cols = DEFAULT_COLS
  let rows = DEFAULT_ROWS
  let title: string | undefined
  if (typeof firstObj.cols === 'number' && firstObj.cols >= 20) cols = Math.floor(firstObj.cols)
  if (typeof firstObj.rows === 'number' && firstObj.rows >= 5) rows = Math.floor(firstObj.rows)
  if (typeof firstObj.title === 'string' && firstObj.title.trim()) title = firstObj.title.trim()

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const outputFrames: ReplayFrame[] = []
  const commandFrames: ReplayFrame[] = []
  let usedPartFiles = false

  for (const line of lines) {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>
      if (!evt || typeof evt !== 'object' || typeof evt.atMs !== 'number') continue
      const rawTimeMs = Math.max(0, Math.round(evt.atMs))
      if (evt.type === 'output') {
        let data: string | null =
          typeof evt.data === 'string' ? evt.data : typeof evt.text === 'string' ? evt.text : null
        if (
          data === null &&
          typeof evt.part === 'number' &&
          typeof evt.offset === 'number' &&
          typeof evt.bytes === 'number' &&
          evt.offset >= 0 &&
          evt.bytes > 0
        ) {
          const partBytes = options?.partFiles?.[evt.part]
          if (partBytes && evt.offset < partBytes.byteLength) {
            const end = Math.min(partBytes.byteLength, evt.offset + evt.bytes)
            const chunk = decoder.decode(partBytes.subarray(evt.offset, end))
            // 若记录的是 plain 纯文本（无 \r 且无 ANSI 控制序列），将裸 \n 规范为 \r\n 避免阶梯错行
            data =
              !chunk.includes('\r') && !chunk.includes('\x1b')
                ? chunk.replace(/\n/g, '\r\n')
                : chunk
            usedPartFiles = true
          }
        }
        if (data !== null) {
          outputFrames.push({ timeMs: rawTimeMs, rawTimeMs, type: 'output', data })
        }
      } else if (evt.type === 'command' && typeof evt.command === 'string') {
        commandFrames.push({
          timeMs: rawTimeMs,
          rawTimeMs,
          type: 'output',
          data: `\r\n\x1b[36m$ ${evt.command}\x1b[0m\r\n`,
        })
      } else if (evt.type === 'resize') {
        const c = typeof evt.cols === 'number' ? Math.floor(evt.cols) : 0
        const r = typeof evt.rows === 'number' ? Math.floor(evt.rows) : 0
        if (c >= 20 && r >= 5) {
          outputFrames.push({ timeMs: rawTimeMs, rawTimeMs, type: 'resize', cols: c, rows: r })
        }
      }
    } catch {
      // skip invalid JSON line
    }
  }

  // 当已从伴生 part-*.log.txt 读取到真实终端输出流时，不再叠加前端半截按键的 command 索引行
  const rawFrames = usedPartFiles
    ? outputFrames
    : [...outputFrames, ...commandFrames].sort((a, b) => a.rawTimeMs - b.rawTimeMs)

  const frames = applyIdleClamp(rawFrames, options?.maxIdleMs)
  const durationMs = frames.length > 0 ? frames[frames.length - 1].timeMs : 0
  return { format: 'qshell-jsonl', title, cols, rows, durationMs, frames }
}

function parsePlainLog(rawText: string): ParsedSessionReplay {
  const normalized = rawText.replace(/\r?\n/g, '\r\n')
  const rawLines = normalized.split('\r\n')
  const frames: ReplayFrame[] = []
  let timeMs = 0
  // Group lines into small chunks so very large logs stay smooth during replay
  const stepMs = rawLines.length > 500 ? 15 : 40
  for (let i = 0; i < rawLines.length; i++) {
    const chunk = i < rawLines.length - 1 ? `${rawLines[i]}\r\n` : rawLines[i]
    if (!chunk) continue
    frames.push({
      timeMs,
      rawTimeMs: timeMs,
      type: 'output',
      data: chunk,
    })
    timeMs += stepMs
  }
  const durationMs = frames.length > 0 ? frames[frames.length - 1].timeMs : 0
  return {
    format: 'plain-log',
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    durationMs,
    frames,
  }
}

/**
 * 解析终端录制内容，自动识别 asciicast v2 (.cast)、Qshell JSONL (.jsonl) 与纯文本/ANSI 日志 (.log)。
 */
export function parseSessionReplay(
  rawText: string,
  options?: ParseReplayOptions,
): ParsedSessionReplay {
  const nonEmptyLines = rawText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)

  const cast = tryParseAsciicastV2(nonEmptyLines, options)
  if (cast) return cast

  const jsonl = tryParseQshellJsonl(nonEmptyLines, options)
  if (jsonl) return jsonl

  return parsePlainLog(rawText)
}

/**
 * 二分查找小于等于 `targetMs` 的最后一帧索引（若无则返回 -1）。
 */
export function findFrameIndexAtTime(frames: ReplayFrame[], targetMs: number): number {
  if (frames.length === 0 || targetMs < frames[0].timeMs) return -1
  let lo = 0
  let hi = frames.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (frames[mid].timeMs <= targetMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

export function formatReplayTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}
