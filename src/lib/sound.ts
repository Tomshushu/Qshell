/**
 * 全局音效工具（WebAudio 合成，无需音频文件）
 *
 * 设计灵感参考 macOS 系统音效（Glass / Tink / Pop / Purr / Hero 等）：
 * 1. 以正弦波 / 三角波为主，避免方波刺耳
 * 2. 精细包络（attack 5ms → decay → sustain → release）避免爆音
 * 3. 多频率叠加增加"质感"，而非单一频率
 * 4. 时长控制在 50-250ms 之间，符合系统提示音惯例
 *
 * 使用示例：
 *   import { playSound, SoundType } from '@/lib/sound'
 *   playSound(SoundType.Success)    // 操作成功
 *   playSound(SoundType.Navigate)   // Tab/模块切换
 *   playSound(SoundType.Open)       // 面板打开
 */

// ── 音效类型 ────────────────────────────────────────────────────────

export enum SoundType {
  /** 终端 BEL 控制字符 (\x07) —— 经典提示音 */
  Bell = 'bell',
  /** Tab / 提示项点击补全成功 —— 清脆短促 */
  Complete = 'complete',
  /** 操作成功（SFTP 完成、连接成功、删除成功等）—— 上行双音，明朗 */
  Success = 'success',
  /** 操作失败 / 错误 —— 下行低沉双音 */
  Error = 'error',
  /** 通用轻量点击反馈（按钮、开关）—— 极短促 Tink */
  Click = 'click',
  /** 警告提示（大文本粘贴、危险操作弹窗）—— 两段不对称音 */
  Warn = 'warn',
  // ── 以下为新增的苹果风格音效 ──
  /** 开关切换（比 Click 稍重，带尾音）—— 类似 macOS Toggle */
  Toggle = 'toggle',
  /** 导航切换（Tab/模块切换）—— 极轻量 Pop */
  Navigate = 'navigate',
  /** 面板/对话框打开 —— 上升音 Glass */
  Open = 'open',
  /** 面板/对话框关闭 —— 下降音 */
  Close = 'close',
  /** 中性通知（info toast）—— 柔和 Purr */
  Notify = 'notify',
  /** 模态确认弹出（非危险）—— 中性提示 */
  Confirm = 'confirm',
  // ── 以下为新增的苹果系统经典音效（更贴近 macOS 原生听觉） ──
  /** 连接成功 / 网络事件 —— 高频钟铃，类似 macOS Ping */
  Ping = 'ping',
  /** 严重错误 / 系统级失败 —— 低沉鼓声，类似 macOS Basso */
  Basso = 'basso',
  /** 致命错误 / 崩溃感 —— 下降锯齿，类似 macOS Funk */
  Funk = 'funk',
  /** SSH 连接状态变化 / 心跳 —— 深沉声纳，类似 macOS Submarine */
  Submarine = 'submarine',
  /** 重要警告 / 不可逆操作提醒 —— 著名 macOS Sosumi 双音 */
  Sosumi = 'sosumi',
  /** 柔和提示 / 细微反馈 —— 类似 macOS Bottle */
  Bottle = 'bottle',

  // ── 兼容旧代码大写别名 ──
  CLICK = 'click',
  SWITCH = 'toggle',
  CONNECTED = 'success',
  ERROR = 'error',
}


// ── 单例 AudioContext ───────────────────────────────────────────────
let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      type AudioContextCtor = new () => AudioContext
      const Ctor =
        (window as unknown as { AudioContext?: AudioContextCtor }).AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
      if (!Ctor) return null
      audioCtx = new Ctor()
    }
    // 用户首次交互前 ctx 可能处于 suspended 状态，尝试恢复
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    return audioCtx
  } catch {
    return null
  }
}

// ── 全局开关 ────────────────────────────────────────────────────────
let soundEnabled = false

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled
}

export function isSoundEnabled(): boolean {
  return soundEnabled
}

// ── 音效参数定义 ────────────────────────────────────────────────────
interface ToneSpec {
  freq: number
  type: OscillatorType
  /** 起始音量（指数包络起点，避免 0 值导致 ramp 失败） */
  startGain: number
  /** 峰值音量 */
  peakGain: number
  /** 结束音量 */
  endGain: number
  /** 总时长（秒） */
  duration: number
  /** 起始偏移（秒），用于多音组合中错峰播放 */
  startOffset?: number
  /** 第二频率（可选，用于增加质感，类似和声） */
  freq2?: number
  /** 第二频率音量比例（相对 peakGain） */
  freq2GainRatio?: number
}

interface SoundSpec {
  tones: ToneSpec[]
}

const SOUND_PRESETS: Record<SoundType, SoundSpec> = {
  // 经典 BEL：880Hz 正弦波，100ms 衰减 + 1760Hz 泛音增加质感
  [SoundType.Bell]: {
    tones: [{
      freq: 880, type: 'sine',
      startGain: 0.001, peakGain: 0.15, endGain: 0.001,
      duration: 0.13,
      freq2: 1760, freq2GainRatio: 0.3,
    }],
  },
  // 补全成功：1320Hz (E6) 三角波，清脆短促 + 高八度泛音
  [SoundType.Complete]: {
    tones: [{
      freq: 1320, type: 'triangle',
      startGain: 0.001, peakGain: 0.18, endGain: 0.001,
      duration: 0.09,
      freq2: 2640, freq2GainRatio: 0.25,
    }],
  },
  // 成功：C5→E5→G5 上行三音（523→659→784Hz），明朗协和，类似 macOS Hero
  [SoundType.Success]: {
    tones: [
      { freq: 523.25, type: 'sine', startGain: 0.001, peakGain: 0.12, endGain: 0.001, duration: 0.1, startOffset: 0 },
      { freq: 659.25, type: 'sine', startGain: 0.001, peakGain: 0.13, endGain: 0.001, duration: 0.1, startOffset: 0.08 },
      { freq: 783.99, type: 'sine', startGain: 0.001, peakGain: 0.15, endGain: 0.001, duration: 0.15, startOffset: 0.16 },
    ],
  },
  // 错误：A4→F4 下行双音 sawtooth，低沉 + 噪声感
  [SoundType.Error]: {
    tones: [
      { freq: 440, type: 'sawtooth', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.15, startOffset: 0 },
      { freq: 349.23, type: 'sawtooth', startGain: 0.001, peakGain: 0.09, endGain: 0.001, duration: 0.2, startOffset: 0.12 },
    ],
  },
  // 通用点击：660Hz 三角波（不用方波，更柔和），极短促，类似 macOS Tink
  [SoundType.Click]: {
    tones: [{
      freq: 660, type: 'triangle',
      startGain: 0.001, peakGain: 0.07, endGain: 0.001,
      duration: 0.04,
      freq2: 1320, freq2GainRatio: 0.2,
    }],
  },
  // 警告：880→660Hz 两段不对称，第一段长第二段短
  [SoundType.Warn]: {
    tones: [
      { freq: 880, type: 'triangle', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.1, startOffset: 0 },
      { freq: 660, type: 'triangle', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.06, startOffset: 0.09 },
    ],
  },
  // 开关切换：440→880Hz 短促上升，带 50ms 尾音，类似 macOS Toggle
  [SoundType.Toggle]: {
    tones: [
      { freq: 440, type: 'sine', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.05, startOffset: 0 },
      { freq: 880, type: 'sine', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.08, startOffset: 0.04 },
    ],
  },
  // 导航切换：880Hz 单音正弦，极轻量，类似 macOS Pop
  [SoundType.Navigate]: {
    tones: [{
      freq: 880, type: 'sine',
      startGain: 0.001, peakGain: 0.06, endGain: 0.001,
      duration: 0.05,
      freq2: 1318, freq2GainRatio: 0.15,
    }],
  },
  // 打开：392→587→784Hz 上升和弦（G3→D4→G4），明朗开放感
  [SoundType.Open]: {
    tones: [
      { freq: 392, type: 'sine', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.08, startOffset: 0 },
      { freq: 587.33, type: 'sine', startGain: 0.001, peakGain: 0.09, endGain: 0.001, duration: 0.1, startOffset: 0.05 },
      { freq: 783.99, type: 'sine', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.12, startOffset: 0.1 },
    ],
  },
  // 关闭：784→587→392Hz 下降和弦，与 Open 对称
  [SoundType.Close]: {
    tones: [
      { freq: 783.99, type: 'sine', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.08, startOffset: 0 },
      { freq: 587.33, type: 'sine', startGain: 0.001, peakGain: 0.09, endGain: 0.001, duration: 0.1, startOffset: 0.05 },
      { freq: 392, type: 'sine', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.12, startOffset: 0.1 },
    ],
  },
  // 通知：523Hz (C5) 单音正弦，柔和，类似 macOS Purr
  [SoundType.Notify]: {
    tones: [{
      freq: 523.25, type: 'sine',
      startGain: 0.001, peakGain: 0.08, endGain: 0.001,
      duration: 0.12,
      freq2: 1046.5, freq2GainRatio: 0.15,
    }],
  },
  // 模态确认：659→880Hz 短促上升，中性提示
  [SoundType.Confirm]: {
    tones: [
      { freq: 659.25, type: 'triangle', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.06, startOffset: 0 },
      { freq: 880, type: 'triangle', startGain: 0.001, peakGain: 0.09, endGain: 0.001, duration: 0.08, startOffset: 0.05 },
    ],
  },
  // ── 苹果系统经典音效 ───────────────────────────────────────────────
  // Ping：1318Hz (E6) 钟铃状快速衰减 + 2637Hz 泛音，类似 macOS Ping
  [SoundType.Ping]: {
    tones: [{
      freq: 1318.51, type: 'sine',
      startGain: 0.001, peakGain: 0.16, endGain: 0.001,
      duration: 0.18,
      freq2: 2637, freq2GainRatio: 0.35,
    }],
  },
  // Basso：130Hz (C3) 低沉正弦 + 87Hz 低八度，类似 macOS Basso
  [SoundType.Basso]: {
    tones: [
      { freq: 130.81, type: 'sine', startGain: 0.001, peakGain: 0.18, endGain: 0.001, duration: 0.22, startOffset: 0 },
      { freq: 87.31, type: 'sine', startGain: 0.001, peakGain: 0.12, endGain: 0.001, duration: 0.25, startOffset: 0.02 },
    ],
  },
  // Funk：200→80Hz 下降锯齿，带噪声感，类似 macOS Funk（崩溃/致命错误）
  [SoundType.Funk]: {
    tones: [
      { freq: 200, type: 'sawtooth', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.18, startOffset: 0 },
      { freq: 120, type: 'sawtooth', startGain: 0.001, peakGain: 0.12, endGain: 0.001, duration: 0.18, startOffset: 0.14 },
      { freq: 80, type: 'sawtooth', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.22, startOffset: 0.3 },
    ],
  },
  // Submarine：70Hz 深沉声纳正弦，慢起音 + 长尾，类似 macOS Submarine
  [SoundType.Submarine]: {
    tones: [{
      freq: 70, type: 'sine',
      startGain: 0.001, peakGain: 0.22, endGain: 0.001,
      duration: 0.55,
      freq2: 140, freq2GainRatio: 0.18,
    }],
  },
  // Sosumi：1170→784Hz 著名 Apple 双音下降钟铃（D6→G5）
  [SoundType.Sosumi]: {
    tones: [
      { freq: 1174.66, type: 'sine', startGain: 0.001, peakGain: 0.13, endGain: 0.001, duration: 0.18, startOffset: 0,
        freq2: 2349.32, freq2GainRatio: 0.25 },
      { freq: 783.99, type: 'sine', startGain: 0.001, peakGain: 0.15, endGain: 0.001, duration: 0.28, startOffset: 0.12,
        freq2: 1567.98, freq2GainRatio: 0.22 },
    ],
  },
  // Bottle：430→310Hz 玻璃瓶状快速衰减 + 高频泛音，类似 macOS Bottle
  [SoundType.Bottle]: {
    tones: [
      { freq: 430, type: 'sine', startGain: 0.001, peakGain: 0.1, endGain: 0.001, duration: 0.1, startOffset: 0,
        freq2: 1290, freq2GainRatio: 0.2 },
      { freq: 310, type: 'sine', startGain: 0.001, peakGain: 0.08, endGain: 0.001, duration: 0.12, startOffset: 0.05 },
    ],
  },
}

// ── 单音合成 ────────────────────────────────────────────────────────
function playTone(ctx: AudioContext, spec: ToneSpec) {
  const startAt = ctx.currentTime + (spec.startOffset ?? 0)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = spec.type
  osc.frequency.value = spec.freq
  // 指数包络：start → peak → end，避免爆音
  gain.gain.setValueAtTime(spec.startGain, startAt)
  gain.gain.exponentialRampToValueAtTime(spec.peakGain, startAt + 0.005)
  gain.gain.exponentialRampToValueAtTime(spec.endGain, startAt + spec.duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + spec.duration + 0.01)
  // 播放结束后显式 disconnect，防止 AudioNode 累积导致内存泄漏
  osc.onended = () => {
    try {
      osc.disconnect()
      gain.disconnect()
    } catch {
      // 静默失败：节点可能已被 GC 或 context 已关闭
    }
  }

  // 第二频率（和声泛音），增加质感
  if (spec.freq2 && spec.freq2GainRatio) {
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = spec.type
    osc2.frequency.value = spec.freq2
    const peak2 = spec.peakGain * spec.freq2GainRatio
    gain2.gain.setValueAtTime(spec.startGain, startAt)
    gain2.gain.exponentialRampToValueAtTime(peak2, startAt + 0.005)
    gain2.gain.exponentialRampToValueAtTime(spec.endGain, startAt + spec.duration)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(startAt)
    osc2.stop(startAt + spec.duration + 0.01)
    osc2.onended = () => {
      try {
        osc2.disconnect()
        gain2.disconnect()
      } catch {
        // 静默失败
      }
    }
  }
}

// ── 对外 API ────────────────────────────────────────────────────────
/**
 * 播放指定类型音效。
 * @param type 音效类型
 * @param forceEnabled 若为 true 则忽略全局开关强制播放（用于用户主动测试等场景）
 */
export function playSound(type: SoundType, forceEnabled = false) {
  if (!forceEnabled && !soundEnabled) return
  const ctx = getAudioCtx()
  if (!ctx) return
  try {
    const spec = SOUND_PRESETS[type]
    if (!spec) return
    spec.tones.forEach(t => playTone(ctx, t))
  } catch {
    // 静默失败
  }
}

/**
 * 释放底层 AudioContext 资源（一般无需手动调用，浏览器关闭时自动回收）。
 */
export function disposeSound() {
  if (audioCtx) {
    try { audioCtx.close() } catch {
      // 关闭失败（如已被回收）忽略
    }
    audioCtx = null
  }
}
