/**
 * packages/qshell-policy/src/truncate.ts
 *
 * 统一输出内容与行数防爆截断器 (8KB / 150 lines)
 */

export const DEFAULT_MAX_OUTPUT_BYTES = 8192
export const DEFAULT_MAX_OUTPUT_LINES = 150

export interface TruncateResult {
  text: string
  truncated: boolean
  originalBytes: number
  outputBytes: number
}

/**
 * 对输出内容执行双重安全截断：
 * 1. 行数截断（默认不超过 150 行）
 * 2. 字节大小截断（默认不超过 8192 字节，约 8KB）
 */
export function truncateOutput(
  content: string,
  maxBytes: number = DEFAULT_MAX_OUTPUT_BYTES,
  maxLines: number = DEFAULT_MAX_OUTPUT_LINES,
): TruncateResult {
  if (!content) {
    return { text: '', truncated: false, originalBytes: 0, outputBytes: 0 }
  }

  const originalBytes = new TextEncoder().encode(content).length
  let truncated = false
  let result = content

  // 1. 行数截断
  const lines = result.split('\n')
  if (lines.length > maxLines) {
    truncated = true
    const keptLines = lines.slice(0, maxLines)
    result = keptLines.join('\n') + `\n\n... [输出超出 ${maxLines} 行，已自动截断以保护内存与上下文] ...`
  }

  // 2. 字节长度截断
  const encoder = new TextEncoder()
  const bytes = encoder.encode(result)
  if (bytes.length > maxBytes) {
    truncated = true
    // 留出提示语空间
    const notice = `\n\n... [输出超出 ${maxBytes} 字节，已自动截断以保护内存与上下文] ...`
    const noticeBytes = encoder.encode(notice).length
    const allowedBytes = Math.max(256, maxBytes - noticeBytes)

    // 切割为安全 UTF-8 字符串
    const decoder = new TextDecoder('utf-8', { fatal: false })
    const slicedBytes = bytes.slice(0, allowedBytes)
    result = decoder.decode(slicedBytes) + notice
  }

  const finalBytes = encoder.encode(result).length

  return {
    text: result,
    truncated,
    originalBytes,
    outputBytes: finalBytes,
  }
}
