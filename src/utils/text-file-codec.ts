/**
 * src/utils/text-file-codec.ts
 *
 * 文本文件的编码检测、解码、编码与换行符处理（参照 Notepad++ 的核心能力）。
 *
 * 设计要点：
 * - 解码：优先用浏览器原生 TextDecoder（跨平台一致、无 Buffer 依赖）；
 * - 编码：TextEncoder 仅支持 UTF-8，非 UTF-8 用 iconv-lite（纯 JS，无原生依赖）；
 * - 检测：BOM 优先 → 严格 UTF-8 判定 → 非 UTF-8 按 GB18030（覆盖 GBK）兜底。
 *   国内服务器文本多为 GBK/GB18030；Big5/Shift-JIS 属于少见场景，后续可加 jschardet 或手动选择。
 */
import * as iconv from 'iconv-lite'

export type TextEol = '\r\n' | '\n' | '\r' | null

/** 后端 files_read 在非 UTF-8 内容时返回的 base64 前缀 */
export const BASE64_PREFIX = '::base64::'

/** 各编码对应的 BOM 字节序列（仅存在 BOM 约定的编码） */
const BOM_BYTES: Record<string, number[]> = {
  'utf-8': [0xef, 0xbb, 0xbf],
  utf8: [0xef, 0xbb, 0xbf],
  'utf-16le': [0xff, 0xfe],
  'utf-16be': [0xfe, 0xff],
}

/** 判断编码是否有 BOM 约定 */
function hasBomConvention(encoding: string): boolean {
  return !!BOM_BYTES[encoding.toLowerCase()]
}

/** 手动可选的编码清单（参照 Notepad++ 常用子集；iconv-lite 已验证支持） */
export const SUPPORTED_ENCODINGS: { value: string; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GB2312 / GBK / GB18030' },
  { value: 'big5', label: 'Big5 (繁體中文)' },
  { value: 'shift-jis', label: 'Shift-JIS (日本語)' },
  { value: 'euc-kr', label: 'EUC-KR (한국어)' },
  { value: 'windows-1251', label: 'Windows-1251 (西里尔)' },
  { value: 'windows-1252', label: 'Windows-1252 (西欧)' },
  { value: 'koi8-r', label: 'KOI8-R (俄语)' },
]

/** 编码显示名（如编辑器工具栏展示） */
export function encodingLabel(encoding: string): string {
  const found = SUPPORTED_ENCODINGS.find((e) => e.value === encoding.toLowerCase())
  return found ? found.label : encoding.toUpperCase()
}

/** 换行符显示名 */
export function eolLabel(eol: TextEol): string {
  if (eol === '\r\n') return 'CRLF'
  if (eol === '\r') return 'CR'
  if (eol === '\n') return 'LF'
  return '—'
}

export interface DecodedTextFile {
  text: string
  /** 检测到的编码（iconv-lite 兼容标签，如 'utf-8'、'gb18030'、'big5'） */
  encoding: string
  /** 文件主导换行符；单行或空文件为 null */
  eol: TextEol
  hasBom: boolean
}

/** iconv 编码标签 → 浏览器 TextDecoder 标签 */
const TEXTDECODER_LABEL: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  gb18030: 'gb18030',
  gbk: 'gb18030',
  big5: 'big5',
  shift_jis: 'shift_jis',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
}

function detectBom(bytes: Uint8Array): { encoding: string; offset: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', offset: 3 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', offset: 2 }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: 'utf-16be', offset: 2 }
  }
  return null
}

function decodeWith(bytes: Uint8Array, encoding: string, fatal = false): string {
  const label = TEXTDECODER_LABEL[encoding.toLowerCase()] || 'utf-8'
  try {
    return new TextDecoder(label, { fatal }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 统计主导换行符 */
export function detectEol(text: string): TextEol {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlf++
        i++
      } else {
        cr++
      }
    } else if (ch === '\n') {
      lf++
    }
  }
  if (crlf > lf && crlf > cr) return '\r\n'
  if (lf > 0) return '\n'
  if (cr > 0) return '\r'
  return null
}

/**
 * 解码后端 `files_read` 的返回文本（stdout）。
 * 后端对非 UTF-8 内容返回 `::base64::<payload>` 前缀；此函数负责识别前缀并解码。
 * 文本路径若带 UTF-8 BOM 字符（U+FEFF），剥离并标记 hasBom，保证保存时能还原。
 */
export function decodeReadResult(raw: string): DecodedTextFile {
  if (raw.startsWith(BASE64_PREFIX)) {
    return decodeTextFile(base64ToBytes(raw.slice(BASE64_PREFIX.length)))
  }
  if (raw.startsWith('\uFEFF')) {
    return { text: raw.slice(1), encoding: 'utf-8', eol: detectEol(raw), hasBom: true }
  }
  return { text: raw, encoding: 'utf-8', eol: detectEol(raw), hasBom: false }
}

/**
 * 按指定编码解码原始字节（用于手动选择编码重新打开，不做自动检测）。
 * BOM 优先：文件带 BOM 时剥离并标记 hasBom，保存时按原样补回。
 */
export function decodeTextWithEncoding(bytes: Uint8Array, encoding: string): DecodedTextFile {
  const bom = detectBom(bytes)
  if (bom) {
    const text = decodeWith(bytes.slice(bom.offset), encoding, false)
    return { text, encoding, eol: detectEol(text), hasBom: true }
  }
  const text = decodeWith(bytes, encoding, false)
  return { text, encoding, eol: detectEol(text), hasBom: false }
}

/** 将原始字节解码为文本，返回文本、编码与换行符信息 */
export function decodeTextFile(bytes: Uint8Array): DecodedTextFile {
  const bom = detectBom(bytes)
  if (bom) {
    const text = decodeWith(bytes.slice(bom.offset), bom.encoding, false)
    return { text, encoding: bom.encoding, eol: detectEol(text), hasBom: true }
  }

  const utf8 = tryDecodeUtf8(bytes)
  if (utf8 !== null) {
    return { text: utf8, encoding: 'utf-8', eol: detectEol(utf8), hasBom: false }
  }

  // 非 UTF-8：按 GB18030（覆盖 GBK）兜底，国内服务器最常见
  const text = decodeWith(bytes, 'gb18030', false)
  return { text, encoding: 'gb18030', eol: detectEol(text), hasBom: false }
}

/**
 * 将文本按指定编码编码为字节（UTF-8 用 TextEncoder，其余用 iconv-lite）。
 * addBom 为 true 时按编码补写 BOM（仅 utf-8 / utf-16le / utf-16be 有 BOM 约定），
 * 保证带 BOM 的文件编辑保存后 BOM 不丢失（参照 Notepad++）。
 */
export function encodeTextFile(text: string, encoding: string, addBom = false): Uint8Array {
  const enc = encoding.toLowerCase()
  const body =
    enc === 'utf-8' || enc === 'utf8'
      ? new TextEncoder().encode(text)
      : Uint8Array.from(iconv.encode(text, encoding))
  if (!addBom || !hasBomConvention(encoding)) return body
  const bom = new Uint8Array(BOM_BYTES[enc])
  const out = new Uint8Array(bom.length + body.length)
  out.set(bom, 0)
  out.set(body, bom.length)
  return out
}

/** 将文本统一换行为指定换行符（保存前调用，避免 CRLF/LF 混合） */
export function normalizeEol(text: string, eol: TextEol): string {
  if (!eol) return text
  const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (eol === '\n') return lf
  return lf.replace(/\n/g, eol)
}

/** Uint8Array → base64（分块避免大文件栈溢出） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/** base64 → Uint8Array */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
