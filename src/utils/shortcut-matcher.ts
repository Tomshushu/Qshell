/**
 * 快捷键标准化解析与匹配工具库
 */

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/** 规范化单键名称（大小写与按键映射） */
export function normalizeKey(key: string): string {
  const k = key.trim()
  if (!k) return ''
  const lower = k.toLowerCase()

  // 功能与特殊按键归一化
  switch (lower) {
    case 'ctrl':
    case 'control':
      return 'Ctrl'
    case 'cmd':
    case 'command':
    case 'meta':
      return 'Cmd'
    case 'alt':
    case 'option':
      return 'Alt'
    case 'shift':
      return 'Shift'
    case 'mod':
      return 'Mod'
    case 'esc':
    case 'escape':
      return 'Escape'
    case 'return':
    case 'enter':
      return 'Enter'
    case 'tab':
      return 'Tab'
    case 'space':
    case ' ':
      return 'Space'
    case 'del':
    case 'delete':
      return 'Delete'
    case 'backspace':
      return 'Backspace'
    case 'arrowup':
    case 'up':
      return '↑'
    case 'arrowdown':
    case 'down':
      return '↓'
    case 'arrowleft':
    case 'left':
      return '←'
    case 'arrowright':
    case 'right':
      return '→'
    default:
      // F1 ~ F12
      if (/^f([1-9]|1[0-2])$/i.test(lower)) {
        return lower.toUpperCase()
      }
      // 字母统一大写
      if (k.length === 1) {
        return k.toUpperCase()
      }
      return k.charAt(0).toUpperCase() + k.slice(1)
  }
}

export interface ParsedAccelerator {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string // 归一化后的主键名，如 'K', 'TAB', 'F11'
}

/** 将加速键字符串解析为布尔标识对象 */
export function parseAccelerator(accelerator: string, isMac = isMacPlatform()): ParsedAccelerator {
  const parts = accelerator.split('+').map((s) => s.trim()).filter(Boolean)
  let ctrl = false
  let alt = false
  let shift = false
  let meta = false
  let key = ''

  for (const part of parts) {
    const norm = normalizeKey(part)
    if (norm === 'Mod') {
      if (isMac) {
        meta = true
      } else {
        ctrl = true
      }
    } else if (norm === 'Ctrl') {
      ctrl = true
    } else if (norm === 'Alt') {
      alt = true
    } else if (norm === 'Shift') {
      shift = true
    } else if (norm === 'Cmd') {
      meta = true
    } else {
      key = norm
    }
  }

  return { ctrl, alt, shift, meta, key }
}

/** 核心校验：检测某个 DOM 键盘事件是否匹配指定的加速键 */
export function matchesShortcut(event: KeyboardEvent, accelerator: string): boolean {
  if (!accelerator) return false
  const isMac = isMacPlatform()
  const parsed = parseAccelerator(accelerator, isMac)

  // 1. 修饰键必须严格对齐
  if (Boolean(event.ctrlKey) !== parsed.ctrl) return false
  if (Boolean(event.altKey) !== parsed.alt) return false
  if (Boolean(event.shiftKey) !== parsed.shift) return false
  if (Boolean(event.metaKey) !== parsed.meta) return false

  // 2. 主键匹配
  const eventKeyNorm = normalizeKey(event.key)
  const targetKeyNorm = parsed.key

  if (!targetKeyNorm) return false

  // 字母与字符比较（忽略大小写）
  if (eventKeyNorm.toLowerCase() === targetKeyNorm.toLowerCase()) {
    return true
  }

  // 应对代码键名映射差异（如 =、-、数字与方向键）
  if (targetKeyNorm === '↑' && (event.key === 'ArrowUp' || event.code === 'ArrowUp')) return true
  if (targetKeyNorm === '↓' && (event.key === 'ArrowDown' || event.code === 'ArrowDown')) return true
  if (targetKeyNorm === '←' && (event.key === 'ArrowLeft' || event.code === 'ArrowLeft')) return true
  if (targetKeyNorm === '→' && (event.key === 'ArrowRight' || event.code === 'ArrowRight')) return true

  if (targetKeyNorm === '=' && (event.key === '=' || event.key === '+' || event.code === 'Equal')) return true
  if (targetKeyNorm === '-' && (event.key === '-' || event.key === '_' || event.code === 'Minus')) return true

  return false
}

/**
 * 将用户按下的 KeyboardEvent 实时转换为加速键字符串
 * 若仅按下了修饰键（尚未按下主键），返回 null 表示录制中
 */
export function eventToAccelerator(event: KeyboardEvent, isMac = isMacPlatform()): string | null {
  const key = event.key
  // 单独按修饰键时忽略
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return null
  }

  const parts: string[] = []

  // 按标准顺序追加修饰键: Ctrl -> Alt -> Shift -> Meta (或 Mod)
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push(isMac ? 'Cmd' : 'Meta')

  const normKey = normalizeKey(key)
  if (!normKey) return null
  parts.push(normKey)

  return parts.join('+')
}

/**
 * 将加速键字符串分解为展示用徽章单元数组
 * 如 'Mod+K' -> Win: ['Ctrl', 'K']，Mac: ['⌘', 'K']
 */
export function acceleratorToDisplayKeys(accelerator: string, isMac = isMacPlatform()): string[] {
  if (!accelerator) return []
  const parts = accelerator.split('+').map((s) => s.trim()).filter(Boolean)
  const result: string[] = []

  for (const part of parts) {
    const norm = normalizeKey(part)
    if (norm === 'Mod') {
      result.push(isMac ? '⌘' : 'Ctrl')
    } else if (norm === 'Ctrl') {
      result.push(isMac ? '⌃' : 'Ctrl')
    } else if (norm === 'Alt') {
      result.push(isMac ? '⌥' : 'Alt')
    } else if (norm === 'Shift') {
      result.push(isMac ? '⇧' : 'Shift')
    } else if (norm === 'Cmd') {
      result.push('⌘')
    } else {
      result.push(norm)
    }
  }

  return result
}
