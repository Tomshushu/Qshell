/**
 * 轻量自包含 RFB (VNC, RFC 6143) 客户端引擎
 *
 * 100% 独立模块，零外部 npm 依赖，直接通过后端本地一次性 WebSocket 桥接器
 * 与远端 VNC Server 通信并渲染至 HTML5 Canvas。
 *
 * 支持特性：
 * - 协议版本：RFB 3.3 / 3.7 / 3.8
 * - 认证方式：None (1)、标准 VNC 密码认证 (2，内置完整 DES 位反转挑战加密)
 * - 帧编码：Raw (0)、CopyRect (1)、RRE (2)、Hextile (5)、DesktopSize (-223)
 * - 交互控制：鼠标移动/点击/滚轮、完整 X11 Keysym 键盘映射、Ctrl+Alt+Del、剪贴板同步
 */

import { createRfbRenderer, type RfbRenderer } from './rfb-renderer'
import {
  TightDecoder,
  TIGHT_SUBENCODING_FILL,
  TIGHT_SUBENCODING_JPEG,
  TIGHT_FILTER_COPY,
  TIGHT_FILTER_PALETTE,
  TIGHT_FILTER_GRADIENT,
} from './tight-decoder'

// ============================================================================
// 标准 VNC DES 挑战加密（RFC 6143 Section 7.2.2：密钥每字节位序反转）
// ============================================================================

const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
]

const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
]

const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
]

const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
]

const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]

const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
]

const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
]

const DES_SBOX: number[][][] = [
  [
    [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7],
    [0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8],
    [4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0],
    [15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  ],
  [
    [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10],
    [3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5],
    [0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15],
    [13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  ],
  [
    [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8],
    [13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1],
    [13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7],
    [1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  ],
  [
    [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15],
    [13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9],
    [10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4],
    [3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  ],
  [
    [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9],
    [14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6],
    [4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14],
    [11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  ],
  [
    [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11],
    [10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8],
    [9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6],
    [4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  ],
  [
    [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1],
    [13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6],
    [1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2],
    [6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  ],
  [
    [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7],
    [1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2],
    [7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8],
    [2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
  ],
]

function reverseByteBits(b: number): number {
  let r = 0
  for (let i = 0; i < 8; i++) {
    r = (r << 1) | ((b >> i) & 1)
  }
  return r & 0xff
}

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((bytes[i] >> bit) & 1)
    }
  }
  return bits
}

function bitsToBytes(bits: number[]): Uint8Array {
  const out = new Uint8Array(bits.length >> 3)
  for (let i = 0; i < out.length; i++) {
    let val = 0
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | (bits[i * 8 + b] & 1)
    }
    out[i] = val
  }
  return out
}

function permute(bits: number[], table: number[]): number[] {
  return table.map((pos) => bits[pos - 1])
}

function leftRotate28(bits: number[], shift: number): number[] {
  return [...bits.slice(shift), ...bits.slice(0, shift)]
}

function desEncryptBlock(block8: Uint8Array, subkeys: number[][]): Uint8Array {
  const ip = permute(bytesToBits(block8), DES_IP)
  let L = ip.slice(0, 32)
  let R = ip.slice(32, 64)

  for (let round = 0; round < 16; round++) {
    const expanded = permute(R, DES_E)
    const xored = expanded.map((b, idx) => b ^ subkeys[round][idx])
    const sboxOut: number[] = []
    for (let s = 0; s < 8; s++) {
      const chunk = xored.slice(s * 6, s * 6 + 6)
      const row = (chunk[0] << 1) | chunk[5]
      const col = (chunk[1] << 3) | (chunk[2] << 2) | (chunk[3] << 1) | chunk[4]
      const val = DES_SBOX[s][row][col]
      sboxOut.push((val >> 3) & 1, (val >> 2) & 1, (val >> 1) & 1, val & 1)
    }
    const fOut = permute(sboxOut, DES_P)
    const nextR = L.map((b, idx) => b ^ fOut[idx])
    L = R
    R = nextR
  }

  const preOutput = [...R, ...L]
  return bitsToBytes(permute(preOutput, DES_FP))
}

/**
 * 使用 VNC 密码加密 16 字节服务端随机挑战
 */
export function vncDesEncryptChallenge(challenge16: Uint8Array, password: string): Uint8Array {
  const keyBytes = new Uint8Array(8)
  for (let i = 0; i < 8; i++) {
    const code = i < password.length ? password.charCodeAt(i) & 0xff : 0
    // VNC 协议特有约定：每个密码字节的 8 个 bit 必须反转位序作为 DES 密钥
    keyBytes[i] = reverseByteBits(code)
  }

  const key56 = permute(bytesToBits(keyBytes), DES_PC1)
  let C = key56.slice(0, 28)
  let D = key56.slice(28, 56)
  const subkeys: number[][] = []
  for (let i = 0; i < 16; i++) {
    C = leftRotate28(C, DES_SHIFTS[i])
    D = leftRotate28(D, DES_SHIFTS[i])
    subkeys.push(permute([...C, ...D], DES_PC2))
  }

  const out = new Uint8Array(16)
  out.set(desEncryptBlock(challenge16.subarray(0, 8), subkeys), 0)
  out.set(desEncryptBlock(challenge16.subarray(8, 16), subkeys), 8)
  return out
}

// ============================================================================
// 键盘 Keysym 映射（DOM KeyboardEvent -> X11 Keysym）
// ============================================================================

const SPECIAL_KEYSYMS: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  CapsLock: 0xffe5,
  MetaLeft: 0xffe7,
  MetaRight: 0xffe8,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
}

export function domEventToKeysym(e: KeyboardEvent): number | null {
  if (SPECIAL_KEYSYMS[e.code]) return SPECIAL_KEYSYMS[e.code]
  if (SPECIAL_KEYSYMS[e.key]) return SPECIAL_KEYSYMS[e.key]
  if (e.key.length === 1) {
    const code = e.key.charCodeAt(0)
    if (code >= 0x20 && code <= 0x7e) return code
    if (code >= 0xa0 && code <= 0xff) return code
    return code | 0x01000000
  }
  return null
}

// ============================================================================
// RFB 客户端主类
// ============================================================================

export type RfbConnectionStatus =
  | 'connecting'
  | 'handshaking'
  | 'authenticating'
  | 'password_required'
  | 'connected'
  | 'disconnected'
  | 'error'

export type VncQualityPreset = 'fast' | 'balanced' | 'high' | 'lossless'

export interface VncSessionStats {
  fps: number
  latencyMs: number
  bandwidthKbps: number
}

export interface RfbClientCallbacks {
  onStatusChange?: (status: RfbConnectionStatus, message?: string) => void
  onDesktopInfo?: (info: { width: number; height: number; name: string }) => void
  onClipboard?: (text: string) => void
  onBell?: () => void
  onStats?: (stats: VncSessionStats) => void
}

type HandshakePhase =
  | 'version'
  | 'security_list'
  | 'security_u32'
  | 'vencrypt_version'
  | 'vencrypt_ack'
  | 'vencrypt_subtypes'
  | 'vnc_challenge'
  | 'security_result'
  | 'security_reason'
  | 'server_init'
  | 'connected'

export class RfbClient {
  private ws: WebSocket | null = null
  private canvas: HTMLCanvasElement
  private renderer: RfbRenderer
  private password: string
  private callbacks: RfbClientCallbacks

  private rxBuf: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  private phase: HandshakePhase = 'version'
  private minorVersion = 8
  private fbWidth = 0
  private fbHeight = 0
  private desktopName = ''
  private viewOnly = false
  private hasExplicitError = false

  // FramebufferUpdate 解析状态
  private pendingRects = 0
  private currentRect: { x: number; y: number; w: number; h: number; encoding: number } | null = null
  private hextileState: {
    tx: number
    ty: number
    bg: [number, number, number]
    fg: [number, number, number]
  } | null = null
  private tightDecoder = new TightDecoder()
  private lastRequestedSize: { w: number; h: number } | null = null
  private qualityPreset: VncQualityPreset = 'balanced'

  // 实时性能与网络统计 (FPS / Ping / 吞吐带宽)
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private framesThisSec = 0
  private bytesThisSec = 0
  private lastLatencyMs = 0
  private pingSentTime = 0
  private isAwaitingPingResponse = false

  constructor(
    canvas: HTMLCanvasElement,
    password: string,
    callbacks: RfbClientCallbacks = {},
  ) {
    this.canvas = canvas
    this.renderer = createRfbRenderer(canvas)
    this.password = password
    this.callbacks = callbacks
  }

  public get renderMode(): 'webgl' | 'canvas2d' {
    return this.renderer.mode
  }

  public destroy(): void {
    this.disconnect()
    this.renderer.destroy()
  }

  public connect(wsUrl: string): void {
    this.disconnect()
    this.hasExplicitError = false
    this.callbacks.onStatusChange?.('connecting')

    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.callbacks.onStatusChange?.('handshaking')
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        this.appendBytes(new Uint8Array(ev.data))
        this.processBuffer()
      } else if (ArrayBuffer.isView(ev.data)) {
        const v = ev.data as ArrayBufferView
        this.appendBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
        this.processBuffer()
      } else if (ev.data && typeof (ev.data as { byteLength?: number }).byteLength === 'number') {
        this.appendBytes(new Uint8Array(ev.data as ArrayBuffer))
        this.processBuffer()
      }
    }

    ws.onerror = () => {
      this.callbacks.onStatusChange?.('error', 'WebSocket 传输通道异常')
    }

    ws.onclose = () => {
      if (this.phase === 'connected') {
        this.callbacks.onStatusChange?.('disconnected', 'VNC 远程连接已断开')
      } else if (!this.hasExplicitError) {
        this.callbacks.onStatusChange?.('error', 'VNC 握手未完成，连接已被远端断开')
      }
    }
  }

  public getStatus(): string {
    return this.phase
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        // ignore
      }
      this.ws = null
    }
    this.rxBuf = new Uint8Array(0)
    this.phase = 'version'
    this.pendingRects = 0
    this.currentRect = null
    this.hextileState = null
    this.lastRequestedSize = null
    this.tightDecoder.resetAllStreams()
    this.stopStatsMonitoring()
    try {
      this.canvas.style.cursor = ''
    } catch {
      // ignore
    }
  }

  private startStatsMonitoring(): void {
    this.stopStatsMonitoring()

    this.statsInterval = setInterval(() => {
      if (this.phase !== 'connected') return
      const fps = this.framesThisSec
      const bandwidthKbps = Math.round((this.bytesThisSec * 8) / 1024)
      this.framesThisSec = 0
      this.bytesThisSec = 0

      this.callbacks.onStats?.({
        fps,
        latencyMs: this.lastLatencyMs,
        bandwidthKbps,
      })
    }, 1000)

    // 每 2.5 秒通过标准 RFB 1x1 探测帧测试一次真实往返延迟 (RTT Ping)
    this.pingInterval = setInterval(() => {
      if (this.phase !== 'connected' || this.isAwaitingPingResponse) return
      this.pingSentTime = performance.now()
      this.isAwaitingPingResponse = true
      this.sendFramebufferUpdateRequest(false, 0, 0, 1, 1)
    }, 2500)
  }

  private stopStatsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    this.isAwaitingPingResponse = false
  }

  public setViewOnly(viewOnly: boolean): void {
    this.viewOnly = viewOnly
  }

  public submitPassword(password: string): void {
    this.password = password
    if (this.phase === 'vnc_challenge' && this.rxBuf.length >= 16) {
      this.processBuffer()
    }
  }

  public sendPointerEvent(x: number, y: number, buttonMask: number): void {
    if (this.viewOnly || this.phase !== 'connected') return
    const clampedX = Math.max(0, Math.min(this.fbWidth - 1, Math.round(x)))
    const clampedY = Math.max(0, Math.min(this.fbHeight - 1, Math.round(y)))
    const msg = new Uint8Array(6)
    msg[0] = 5 // PointerEvent
    msg[1] = buttonMask & 0xff
    msg[2] = (clampedX >> 8) & 0xff
    msg[3] = clampedX & 0xff
    msg[4] = (clampedY >> 8) & 0xff
    msg[5] = clampedY & 0xff
    this.sendRaw(msg)
  }

  public sendKeyEvent(keysym: number, down: boolean): void {
    if (this.viewOnly || this.phase !== 'connected') return
    const msg = new Uint8Array(8)
    msg[0] = 4 // KeyEvent
    msg[1] = down ? 1 : 0
    msg[2] = 0
    msg[3] = 0
    msg[4] = (keysym >>> 24) & 0xff
    msg[5] = (keysym >>> 16) & 0xff
    msg[6] = (keysym >>> 8) & 0xff
    msg[7] = keysym & 0xff
    this.sendRaw(msg)
  }

  public sendCtrlAltDel(): void {
    if (this.viewOnly || this.phase !== 'connected') return
    this.sendKeyEvent(0xffe3, true)  // Control_L
    this.sendKeyEvent(0xffe9, true)  // Alt_L
    this.sendKeyEvent(0xffff, true)  // Delete
    this.sendKeyEvent(0xffff, false)
    this.sendKeyEvent(0xffe9, false)
    this.sendKeyEvent(0xffe3, false)
  }

  public sendWindowsKey(): void {
    if (this.viewOnly || this.phase !== 'connected') return
    this.sendKeyEvent(0xffeb, true)  // Super_L (Windows / Meta key)
    this.sendKeyEvent(0xffeb, false)
  }

  public sendAltTab(): void {
    if (this.viewOnly || this.phase !== 'connected') return
    this.sendKeyEvent(0xffe9, true)  // Alt_L
    this.sendKeyEvent(0xff09, true)  // Tab
    this.sendKeyEvent(0xff09, false)
    this.sendKeyEvent(0xffe9, false)
  }

  public sendClientCutText(text: string): void {
    if (this.viewOnly || this.phase !== 'connected') return
    const encoded = new TextEncoder().encode(text)
    const msg = new Uint8Array(8 + encoded.length)
    msg[0] = 6 // ClientCutText
    const len = encoded.length
    msg[4] = (len >>> 24) & 0xff
    msg[5] = (len >>> 16) & 0xff
    msg[6] = (len >>> 8) & 0xff
    msg[7] = len & 0xff
    msg.set(encoded, 8)
    this.sendRaw(msg)
  }

  /**
   * 将多字节字符串或中文文本转换为 RFB 键击序列逐字发送 (支持 Unicode / 中文 / 特殊符号 / 换行)
   */
  public sendText(text: string): void {
    if (this.viewOnly || this.phase !== 'connected' || !text) return
    for (const char of text) {
      const code = char.codePointAt(0)
      if (code === undefined) continue
      let keysym: number
      if (code === 10 || code === 13) {
        keysym = 0xff0d // Return
      } else if (code === 9) {
        keysym = 0xff09 // Tab
      } else if (code === 8) {
        keysym = 0xff08 // BackSpace
      } else if (code >= 0x20 && code <= 0x7e) {
        keysym = code
      } else if (code >= 0xa0 && code <= 0xff) {
        keysym = code
      } else {
        // X11 Unicode Keysym: 0x01000000 | codepoint
        keysym = 0x01000000 | code
      }
      this.sendKeyEvent(keysym, true)
      this.sendKeyEvent(keysym, false)
    }
  }

  public requestFullRefresh(): void {
    if (this.phase !== 'connected') return
    this.sendFramebufferUpdateRequest(false, 0, 0, this.fbWidth, this.fbHeight)
  }

  /**
   * 动态设置 Tight 编码的画质与压缩级别档位 (RFC 6143 Pseudo-encodings)
   */
  public setQualityPreset(preset: VncQualityPreset): void {
    this.qualityPreset = preset
    if (this.phase === 'connected') {
      this.sendCurrentEncodings()
      this.requestFullRefresh()
    }
  }

  public getQualityPreset(): VncQualityPreset {
    return this.qualityPreset
  }

  /**
   * 向远端服务端请求动态调整桌面分辨率 (RFC 6143 / ExtendedDesktopSize SetDesktopSize Type 251)
   */
  public requestDesktopSize(width: number, height: number): void {
    if (this.phase !== 'connected') return
    const w = Math.max(64, Math.min(8192, Math.round(width))) & ~1
    const h = Math.max(64, Math.min(8192, Math.round(height)))

    // 若目标尺寸与当前桌面尺寸完全相同，或者与正在请求的尺寸相同，避免重复下发
    if (w === this.fbWidth && h === this.fbHeight) return
    if (this.lastRequestedSize && this.lastRequestedSize.w === w && this.lastRequestedSize.h === h) return
    this.lastRequestedSize = { w, h }

    // 发送标准 24 字节 SetDesktopSize (Type 251 + 1 Screen Layout)
    const msg = new Uint8Array(24)
    const dv = new DataView(msg.buffer)
    msg[0] = 251 // SetDesktopSize
    msg[1] = 0   // pad
    dv.setUint16(2, w) // requested width
    dv.setUint16(4, h) // requested height
    msg[6] = 1   // numberOfScreens = 1
    msg[7] = 0   // pad

    // Screen 0 layout: 16 字节
    dv.setUint32(8, 0)   // screen id = 0
    dv.setUint16(12, 0)  // x = 0
    dv.setUint16(14, 0)  // y = 0
    dv.setUint16(16, w)  // screen width
    dv.setUint16(18, h)  // screen height
    dv.setUint32(20, 0)  // flags = 0

    this.sendRaw(msg)
  }

  // ============================================================================
  // 内部协议处理
  // ============================================================================

  private appendBytes(chunk: Uint8Array): void {
    this.bytesThisSec += chunk.length
    if (this.rxBuf.length === 0) {
      this.rxBuf = chunk
      return
    }
    const merged = new Uint8Array(this.rxBuf.length + chunk.length)
    merged.set(this.rxBuf, 0)
    merged.set(chunk, this.rxBuf.length)
    this.rxBuf = merged
  }

  private consume(n: number): Uint8Array {
    const slice = this.rxBuf.subarray(0, n)
    this.rxBuf = this.rxBuf.subarray(n)
    return slice
  }

  private readU16BE(offset: number): number {
    return (this.rxBuf[offset] << 8) | this.rxBuf[offset + 1]
  }

  private readU32BE(offset: number): number {
    return (
      ((this.rxBuf[offset] << 24) |
        (this.rxBuf[offset + 1] << 16) |
        (this.rxBuf[offset + 2] << 8) |
        this.rxBuf[offset + 3]) >>>
      0
    )
  }

  private readI32BE(offset: number): number {
    return (
      (this.rxBuf[offset] << 24) |
      (this.rxBuf[offset + 1] << 16) |
      (this.rxBuf[offset + 2] << 8) |
      this.rxBuf[offset + 3]
    )
  }

  private sendRaw(bytes: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(bytes as unknown as BufferSource)
    }
  }

  private processBuffer(): void {
    while (this.rxBuf.length > 0) {
      if (this.phase === 'version') {
        if (this.rxBuf.length < 12) return
        const banner = new TextDecoder().decode(this.consume(12))
        if (!banner.startsWith('RFB ')) {
          this.hasExplicitError = true
          this.callbacks.onStatusChange?.('error', `无效的 RFB 握手头: ${banner}`)
          this.disconnect()
          return
        }
        const minor = parseInt(banner.slice(8, 11), 10)
        if (minor === 3) {
          this.minorVersion = 3
          this.sendRaw(new TextEncoder().encode('RFB 003.003\n'))
          this.phase = 'security_u32'
        } else if (minor === 7) {
          this.minorVersion = 7
          this.sendRaw(new TextEncoder().encode('RFB 003.007\n'))
          this.phase = 'security_list'
        } else {
          this.minorVersion = 8
          this.sendRaw(new TextEncoder().encode('RFB 003.008\n'))
          this.phase = 'security_list'
        }
        continue
      }

      if (this.phase === 'security_list') {
        if (this.rxBuf.length < 1) return
        const count = this.rxBuf[0]
        if (count === 0) {
          this.consume(1)
          this.phase = 'security_reason'
          continue
        }
        if (this.rxBuf.length < 1 + count) return
        const types = Array.from(this.consume(1 + count).subarray(1))
        if (types.includes(1)) {
          // None 认证
          this.sendRaw(new Uint8Array([1]))
          this.phase = this.minorVersion >= 8 ? 'security_result' : 'server_init'
        } else if (types.includes(2)) {
          // VNC Password 认证
          this.callbacks.onStatusChange?.('authenticating')
          this.sendRaw(new Uint8Array([2]))
          this.phase = 'vnc_challenge'
        } else if (types.includes(19)) {
          // VeNCrypt 协议握手（Security Type 19）
          this.callbacks.onStatusChange?.('authenticating', '协商 VeNCrypt 0.2 安全协议...')
          this.sendRaw(new Uint8Array([19]))
          this.phase = 'vencrypt_version'
        } else {
          this.callbacks.onStatusChange?.(
            'error',
            `VNC 服务端要求不受支持的认证类型: [${types.join(', ')}]（请开启标准 VNC 密码认证）`,
          )
          this.disconnect()
          return
        }
        continue
      }

      if (this.phase === 'security_u32') {
        if (this.rxBuf.length < 4) return
        const secType = this.readU32BE(0)
        this.consume(4)
        if (secType === 0) {
          this.phase = 'security_reason'
        } else if (secType === 1) {
          this.phase = 'server_init'
        } else if (secType === 2) {
          this.callbacks.onStatusChange?.('authenticating')
          this.phase = 'vnc_challenge'
        } else {
          this.callbacks.onStatusChange?.('error', `不支持的 RFB 3.3 认证类型: ${secType}`)
          this.disconnect()
          return
        }
        continue
      }

      if (this.phase === 'vencrypt_version') {
        if (this.rxBuf.length < 2) return
        this.consume(2) // 读取服务端 major, minor (如 0, 2)
        // 回复 VeNCrypt 0.2
        this.sendRaw(new Uint8Array([0, 2]))
        this.phase = 'vencrypt_ack'
        continue
      }

      if (this.phase === 'vencrypt_ack') {
        if (this.rxBuf.length < 1) return
        const [status] = this.consume(1)
        if (status !== 0) {
          this.callbacks.onStatusChange?.('error', 'VeNCrypt 版本协商被服务端拒绝')
          this.disconnect()
          return
        }
        this.phase = 'vencrypt_subtypes'
        continue
      }

      if (this.phase === 'vencrypt_subtypes') {
        if (this.rxBuf.length < 1) return
        const count = this.rxBuf[0]
        if (this.rxBuf.length < 1 + count * 4) return
        this.consume(1)
        const subtypes: number[] = []
        for (let i = 0; i < count; i++) {
          subtypes.push(this.readU32BE(i * 4))
        }
        this.consume(count * 4)

        if (subtypes.includes(256)) {
          // 协商选定 VeNCrypt Plain (256 = 0x0100)
          this.sendRaw(new Uint8Array([0, 0, 1, 0]))
          // 构造用户名与密码凭证载荷（无用户名，仅密码）
          const userBytes = new TextEncoder().encode('')
          const pwdBytes = new TextEncoder().encode(this.password || '')
          const cred = new Uint8Array(8 + userBytes.length + pwdBytes.length)
          const dv = new DataView(cred.buffer)
          dv.setUint32(0, userBytes.length)
          dv.setUint32(4, pwdBytes.length)
          cred.set(userBytes, 8)
          cred.set(pwdBytes, 8 + userBytes.length)
          this.sendRaw(cred)
          this.phase = 'security_result'
        } else {
          // 其余 TLS 子类型（TLSVnc, TLSNone, X509Vnc）在 Qshell 后端驱动下已自动转接为原生 TLS
          this.callbacks.onStatusChange?.('authenticating', 'VeNCrypt TLS 握手就绪')
        }
        continue
      }

      if (this.phase === 'vnc_challenge') {
        if (this.rxBuf.length < 16) return
        if (!this.password) {
          this.callbacks.onStatusChange?.('password_required')
          return
        }
        const challenge = this.consume(16)
        const response = vncDesEncryptChallenge(challenge, this.password)
        this.sendRaw(response)
        this.phase = 'security_result'
        continue
      }

      if (this.phase === 'security_result') {
        if (this.rxBuf.length < 4) return
        const status = this.readU32BE(0)
        this.consume(4)
        if (status === 0) {
          // 认证通过，发送 ClientInit(shared=1)
          this.sendRaw(new Uint8Array([1]))
          this.phase = 'server_init'
        } else if (this.minorVersion >= 8) {
          this.phase = 'security_reason'
        } else {
          this.hasExplicitError = true
          this.callbacks.onStatusChange?.('error', 'VNC 密码认证失败')
          this.disconnect()
          return
        }
        continue
      }

      if (this.phase === 'security_reason') {
        if (this.rxBuf.length < 4) return
        const len = this.readU32BE(0)
        if (this.rxBuf.length < 4 + len) return
        const reasonBytes = this.consume(4 + len).subarray(4)
        const reason = new TextDecoder().decode(reasonBytes)
        this.hasExplicitError = true
        let friendlyReason = reason
        if (/too many security failures/i.test(reason)) {
          friendlyReason = '密码连续错误过多，远端 VNC 服务已触发防爆破临时锁定 (Too many security failures)'
        }
        this.callbacks.onStatusChange?.('error', `VNC 握手被拒绝: ${friendlyReason}`)
        this.disconnect()
        return
      }

      if (this.phase === 'server_init') {
        if (this.rxBuf.length < 24) return
        const width = this.readU16BE(0)
        const height = this.readU16BE(2)
        const nameLen = this.readU32BE(20)
        if (this.rxBuf.length < 24 + nameLen) return
        const initMsg = this.consume(24 + nameLen)
        this.fbWidth = width
        this.fbHeight = height
        this.desktopName = new TextDecoder().decode(initMsg.subarray(24))

        this.renderer.init(width, height)

        // 配置 32-bit TrueColor 像素格式（R=0, G=8, B=16，小端序，直映 Canvas ImageData）
        this.sendSetPixelFormat()
        // 声明支持的编码：优先 Tight 现代流式高压缩比编码 (7)，其次 CopyRect(1), Hextile(5), RRE(2), Raw(0), ExtendedDesktopSize(-308), DesktopSize(-223), Cursor(-239)
        this.sendCurrentEncodings()
        // 请求首帧全量画面
        this.sendFramebufferUpdateRequest(false, 0, 0, width, height)

        this.phase = 'connected'
        this.startStatsMonitoring()
        this.callbacks.onDesktopInfo?.({ width, height, name: this.desktopName })
        this.callbacks.onStatusChange?.('connected')
        continue
      }

      if (this.phase === 'connected') {
        if (!this.processConnectedMessages()) {
          return
        }
      }
    }
  }

  private processConnectedMessages(): boolean {
    if (this.pendingRects > 0 || this.currentRect !== null) {
      return this.processRectangles()
    }

    if (this.rxBuf.length < 1) return false
    const msgType = this.rxBuf[0]

    switch (msgType) {
      case 0: {
        // FramebufferUpdate: [0, pad, numRects(u16)]
        if (this.rxBuf.length < 4) return false
        const numRects = this.readU16BE(2)
        this.consume(4)
        this.pendingRects = numRects
        if (numRects === 0) {
          this.sendFramebufferUpdateRequest(true, 0, 0, this.fbWidth, this.fbHeight)
          return true
        }
        return this.processRectangles()
      }
      case 1: {
        // SetColourMapEntries: [1, pad, firstColour(u16), numColours(u16), ...]
        if (this.rxBuf.length < 6) return false
        const numColours = this.readU16BE(4)
        const total = 6 + numColours * 6
        if (this.rxBuf.length < total) return false
        this.consume(total)
        return true
      }
      case 2: {
        // Bell
        this.consume(1)
        this.callbacks.onBell?.()
        return true
      }
      case 3: {
        // ServerCutText: [3, pad*3, length(u32), text...]
        if (this.rxBuf.length < 8) return false
        const len = this.readU32BE(4)
        if (this.rxBuf.length < 8 + len) return false
        const textBytes = this.consume(8 + len).subarray(8)
        this.callbacks.onClipboard?.(new TextDecoder().decode(textBytes))
        return true
      }
      default: {
        // 未知消息类型，安全断开防止失步
        this.callbacks.onStatusChange?.('error', `收到未知的 RFB 消息类型: ${msgType}`)
        this.disconnect()
        return false
      }
    }
  }

  private processRectangles(): boolean {
    while (this.pendingRects > 0 || this.currentRect !== null) {
      if (!this.currentRect) {
        if (this.rxBuf.length < 12) {
          this.renderer.flush()
          return false
        }
        const x = this.readU16BE(0)
        const y = this.readU16BE(2)
        const w = this.readU16BE(4)
        const h = this.readU16BE(6)
        const encoding = this.readI32BE(8)
        this.consume(12)
        this.currentRect = { x, y, w, h, encoding }
      }

      const { x, y, w, h, encoding } = this.currentRect

      // Cursor 伪编码 (-239)：接管远端鼠标形状，远端停止在桌面画布里画鼠标
      if (encoding === -239) {
        if (!this.handleCursorPseudoEncoding(x, y, w, h)) {
          this.renderer.flush()
          return false
        }
        continue
      }

      if (w === 0 || h === 0) {
        this.finishCurrentRect()
        continue
      }

      // DesktopSize 伪编码 (-223)
      if (encoding === -223) {
        this.lastRequestedSize = null
        this.fbWidth = w
        this.fbHeight = h
        this.renderer.resize(w, h)
        this.callbacks.onDesktopInfo?.({ width: w, height: h, name: this.desktopName })
        this.finishCurrentRect()
        continue
      }

      // ExtendedDesktopSize 伪编码 (-308)
      if (encoding === -308) {
        if (this.rxBuf.length < 4) {
          this.renderer.flush()
          return false
        }
        const numberOfScreens = this.rxBuf[0]
        const totalNeed = 4 + numberOfScreens * 16
        if (this.rxBuf.length < totalNeed) {
          this.renderer.flush()
          return false
        }
        this.consume(totalNeed)

        this.lastRequestedSize = null
        // y 字段为状态码：0 为成功更改
        if (y === 0) {
          this.fbWidth = w
          this.fbHeight = h
          this.renderer.resize(w, h)
          this.callbacks.onDesktopInfo?.({ width: w, height: h, name: this.desktopName })
        }
        this.finishCurrentRect()
        continue
      }

      // Raw 编码 (0)
      if (encoding === 0) {
        const byteCount = w * h * 4
        if (this.rxBuf.length < byteCount) {
          this.renderer.flush()
          return false
        }
        const raw = this.consume(byteCount)
        this.renderer.paintRawPixels(x, y, w, h, raw)
        this.finishCurrentRect()
        continue
      }

      // CopyRect 编码 (1)
      if (encoding === 1) {
        if (this.rxBuf.length < 4) {
          this.renderer.flush()
          return false
        }
        const srcX = this.readU16BE(0)
        const srcY = this.readU16BE(2)
        this.consume(4)
        this.renderer.copyRect(srcX, srcY, w, h, x, y)
        this.finishCurrentRect()
        continue
      }

      // RRE 编码 (2)
      if (encoding === 2) {
        if (this.rxBuf.length < 8) {
          this.renderer.flush()
          return false
        }
        const numSubrects = this.readU32BE(0)
        const totalBytes = 8 + numSubrects * 12
        if (this.rxBuf.length < totalBytes) {
          this.renderer.flush()
          return false
        }
        const payload = this.consume(totalBytes)
        this.renderer.fillRect(x, y, w, h, payload[4], payload[5], payload[6])
        let offset = 8
        for (let i = 0; i < numSubrects; i++) {
          const r = payload[offset]
          const g = payload[offset + 1]
          const b = payload[offset + 2]
          const sx = (payload[offset + 4] << 8) | payload[offset + 5]
          const sy = (payload[offset + 6] << 8) | payload[offset + 7]
          const sw = (payload[offset + 8] << 8) | payload[offset + 9]
          const sh = (payload[offset + 10] << 8) | payload[offset + 11]
          this.renderer.fillRect(x + sx, y + sy, sw, sh, r, g, b)
          offset += 12
        }
        this.finishCurrentRect()
        continue
      }

      // Hextile 编码 (5)
      if (encoding === 5) {
        if (!this.processHextileRect(x, y, w, h)) {
          this.renderer.flush()
          return false
        }
        this.finishCurrentRect()
        continue
      }

      // Tight 现代高压缩比编码 (7)
      if (encoding === 7) {
        if (!this.processTightRect(x, y, w, h)) {
          this.renderer.flush()
          return false
        }
        this.finishCurrentRect()
        continue
      }

      this.callbacks.onStatusChange?.('error', `未支持的 VNC 图像编码: ${encoding}`)
      this.disconnect()
      return false
    }

    // 全部矩形渲染完毕，提交 WebGL 纹理并立刻请求下一帧增量更新
    this.renderer.flush()
    this.framesThisSec++
    if (this.isAwaitingPingResponse) {
      this.isAwaitingPingResponse = false
      this.lastLatencyMs = Math.max(1, Math.round(performance.now() - this.pingSentTime))
    }
    this.sendFramebufferUpdateRequest(true, 0, 0, this.fbWidth, this.fbHeight)
    return true
  }

  private processHextileRect(rx: number, ry: number, rw: number, rh: number): boolean {
    if (!this.hextileState) {
      this.hextileState = {
        tx: rx,
        ty: ry,
        bg: [0, 0, 0],
        fg: [0, 0, 0],
      }
    }

    const st = this.hextileState
    while (st.ty < ry + rh) {
      const th = Math.min(16, ry + rh - st.ty)
      while (st.tx < rx + rw) {
        const tw = Math.min(16, rx + rw - st.tx)
        if (this.rxBuf.length < 1) {
          this.renderer.flush()
          return false
        }
        const subenc = this.rxBuf[0]

        // Raw tile (bit 0)
        if (subenc & 1) {
          const need = 1 + tw * th * 4
          if (this.rxBuf.length < need) {
            this.renderer.flush()
            return false
          }
          const tileBytes = this.consume(need).subarray(1)
          this.renderer.paintRawPixels(st.tx, st.ty, tw, th, tileBytes)
          st.tx += 16
          continue
        }

        // 先预演计算当前 16x16 瓦片共需多少字节，集齐后再一次性消费
        let cursor = 1
        let bg = st.bg
        let fg = st.fg
        if (subenc & 2) {
          if (this.rxBuf.length < cursor + 4) {
            this.renderer.flush()
            return false
          }
          bg = [this.rxBuf[cursor], this.rxBuf[cursor + 1], this.rxBuf[cursor + 2]]
          cursor += 4
        }
        if (subenc & 4) {
          if (this.rxBuf.length < cursor + 4) {
            this.renderer.flush()
            return false
          }
          fg = [this.rxBuf[cursor], this.rxBuf[cursor + 1], this.rxBuf[cursor + 2]]
          cursor += 4
        }
        let numSubrects = 0
        if (subenc & 8) {
          if (this.rxBuf.length < cursor + 1) {
            this.renderer.flush()
            return false
          }
          numSubrects = this.rxBuf[cursor]
          cursor += 1
          const perSub = (subenc & 16) ? 6 : 2
          if (this.rxBuf.length < cursor + numSubrects * perSub) {
            this.renderer.flush()
            return false
          }
        }

        st.bg = bg
        st.fg = fg
        this.renderer.fillRect(st.tx, st.ty, tw, th, bg[0], bg[1], bg[2])

        if (subenc & 8) {
          const colored = (subenc & 16) !== 0
          for (let i = 0; i < numSubrects; i++) {
            let cr = fg[0]
            let cg = fg[1]
            let cb = fg[2]
            if (colored) {
              cr = this.rxBuf[cursor]
              cg = this.rxBuf[cursor + 1]
              cb = this.rxBuf[cursor + 2]
              cursor += 4
            }
            const xy = this.rxBuf[cursor]
            const wh = this.rxBuf[cursor + 1]
            cursor += 2
            const sx = (xy >> 4) & 0x0f
            const sy = xy & 0x0f
            const sw = ((wh >> 4) & 0x0f) + 1
            const sh = (wh & 0x0f) + 1
            this.renderer.fillRect(st.tx + sx, st.ty + sy, sw, sh, cr, cg, cb)
          }
        }

        this.consume(cursor)
        st.tx += 16
      }
      st.tx = rx
      st.ty += 16
    }

    this.hextileState = null
    return true
  }

  private processTightRect(x: number, y: number, w: number, h: number): boolean {
    if (this.rxBuf.length < 1) return false
    const compCtl = this.rxBuf[0]

    // 处理 reset zlib stream 掩码（bit 0..3 对应 4 个 stream）
    for (let i = 0; i < 4; i++) {
      if ((compCtl & (1 << i)) !== 0) {
        this.tightDecoder.resetStream(i)
      }
    }

    const subencoding = (compCtl >> 4) & 0x0f

    // 1. Fill 纯色填充 (0x08)
    if (subencoding === TIGHT_SUBENCODING_FILL) {
      if (this.rxBuf.length < 4) return false
      const r = this.rxBuf[1]
      const g = this.rxBuf[2]
      const b = this.rxBuf[3]
      this.consume(4)
      this.renderer.fillRect(x, y, w, h, r, g, b)
      return true
    }

    // 2. JPEG 压缩 (0x09)
    if (subencoding === TIGHT_SUBENCODING_JPEG) {
      const lenInfo = TightDecoder.readCompactLength(this.rxBuf, 1)
      if (!lenInfo) return false
      const totalNeed = 1 + lenInfo.bytesRead + lenInfo.length
      if (this.rxBuf.length < totalNeed) return false
      const jpegData = this.rxBuf.subarray(1 + lenInfo.bytesRead, totalNeed)
      this.consume(totalNeed)

      if (typeof Image !== 'undefined') {
        try {
          const blob = new Blob([jpegData as unknown as BlobPart], { type: 'image/jpeg' })
          const url = URL.createObjectURL(blob)
          const img = new Image()
          img.onload = () => {
            URL.revokeObjectURL(url)
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = w
            tempCanvas.height = h
            const ctx = tempCanvas.getContext('2d')
            if (ctx) {
              ctx.drawImage(img, 0, 0, w, h)
              const imgData = ctx.getImageData(0, 0, w, h)
              this.renderer.paintRawPixels(x, y, w, h, new Uint8Array(imgData.data.buffer))
              this.renderer.flush()
            }
          }
          img.src = url
        } catch {
          // ignore
        }
      }
      return true
    }

    // 3. Basic 基础压缩 (0x00 .. 0x07)
    let offset = 1
    const explicitFilter = (compCtl & 0x40) !== 0
    let filterId = TIGHT_FILTER_COPY
    if (explicitFilter) {
      if (this.rxBuf.length < offset + 1) return false
      filterId = this.rxBuf[offset++]
    }
    const streamId = (compCtl >> 4) & 0x03

    // 分支 3.1: 调色板 Palette (filterId === 1)
    if (filterId === TIGHT_FILTER_PALETTE) {
      if (this.rxBuf.length < offset + 1) return false
      const numColors = this.rxBuf[offset++] + 1

      if (numColors === 1) {
        // 单色调色板
        if (this.rxBuf.length < offset + 3) return false
        const r = this.rxBuf[offset]
        const g = this.rxBuf[offset + 1]
        const b = this.rxBuf[offset + 2]
        this.consume(offset + 3)
        this.renderer.fillRect(x, y, w, h, r, g, b)
        return true
      }

      // 多色调色板：numColors * 3 字节调色板数据
      const paletteLen = numColors * 3
      if (this.rxBuf.length < offset + paletteLen) return false
      const palette = this.rxBuf.subarray(offset, offset + paletteLen)
      offset += paletteLen

      let uncompressedSize = 0
      if (numColors === 2) {
        const rowBytes = Math.floor((w + 7) / 8)
        uncompressedSize = rowBytes * h
      } else {
        uncompressedSize = w * h
      }

      let rawIndexData: Uint8Array
      if (uncompressedSize < 12) {
        if (this.rxBuf.length < offset + uncompressedSize) return false
        const slice = this.consume(offset + uncompressedSize)
        rawIndexData = slice.subarray(offset)
      } else {
        const lenInfo = TightDecoder.readCompactLength(this.rxBuf, offset)
        if (!lenInfo) return false
        const totalNeed = offset + lenInfo.bytesRead + lenInfo.length
        if (this.rxBuf.length < totalNeed) return false
        const slice = this.consume(totalNeed)
        const compressed = slice.subarray(offset + lenInfo.bytesRead)
        rawIndexData = this.tightDecoder.decompress(streamId, compressed, uncompressedSize)
      }

      const rgba = new Uint8Array(w * h * 4)
      if (numColors === 2) {
        TightDecoder.decodeMonoPalette(rawIndexData, rgba, w, h, palette)
      } else {
        TightDecoder.decodeMultiPalette(rawIndexData, rgba, w * h, palette)
      }
      this.renderer.paintRawPixels(x, y, w, h, rgba)
      return true
    }

    // 分支 3.2: 渐变预测滤镜 Gradient (filterId === 2)
    if (filterId === TIGHT_FILTER_GRADIENT) {
      const uncompressedSize = w * h * 3
      let rawGradData: Uint8Array
      if (uncompressedSize < 12) {
        if (this.rxBuf.length < offset + uncompressedSize) return false
        const slice = this.consume(offset + uncompressedSize)
        rawGradData = slice.subarray(offset)
      } else {
        const lenInfo = TightDecoder.readCompactLength(this.rxBuf, offset)
        if (!lenInfo) return false
        const totalNeed = offset + lenInfo.bytesRead + lenInfo.length
        if (this.rxBuf.length < totalNeed) return false
        const slice = this.consume(totalNeed)
        const compressed = slice.subarray(offset + lenInfo.bytesRead)
        rawGradData = this.tightDecoder.decompress(streamId, compressed, uncompressedSize)
      }

      const rgba = new Uint8Array(w * h * 4)
      TightDecoder.decodeGradient(rawGradData, rgba, w, h)
      this.renderer.paintRawPixels(x, y, w, h, rgba)
      return true
    }

    // 分支 3.3: 无滤镜原始像素 Copy (filterId === 0)
    if (filterId === TIGHT_FILTER_COPY) {
      const uncompressedSize = w * h * 3
      let rawRgbData: Uint8Array
      if (uncompressedSize < 12) {
        if (this.rxBuf.length < offset + uncompressedSize) return false
        const slice = this.consume(offset + uncompressedSize)
        rawRgbData = slice.subarray(offset)
      } else {
        const lenInfo = TightDecoder.readCompactLength(this.rxBuf, offset)
        if (!lenInfo) return false
        const totalNeed = offset + lenInfo.bytesRead + lenInfo.length
        if (this.rxBuf.length < totalNeed) return false
        const slice = this.consume(totalNeed)
        const compressed = slice.subarray(offset + lenInfo.bytesRead)
        rawRgbData = this.tightDecoder.decompress(streamId, compressed, uncompressedSize)
      }

      const rgba = new Uint8Array(w * h * 4)
      TightDecoder.decodeRawRgb(rawRgbData, rgba, w * h)
      this.renderer.paintRawPixels(x, y, w, h, rgba)
      return true
    }

    throw new Error(`Unsupported Tight filter id: ${filterId}`)
  }

  private handleCursorPseudoEncoding(hotspotX: number, hotspotY: number, w: number, h: number): boolean {
    if (w === 0 || h === 0) {
      this.canvas.style.cursor = 'none'
      this.finishCurrentRect()
      return true
    }

    const pixelBytes = w * h * 4
    const maskRowBytes = Math.floor((w + 7) / 8)
    const maskBytes = maskRowBytes * h
    const totalNeed = pixelBytes + maskBytes

    if (this.rxBuf.length < totalNeed) return false

    const pixelData = this.rxBuf.subarray(0, pixelBytes)
    const maskData = this.rxBuf.subarray(pixelBytes, totalNeed)

    try {
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = w
      tempCanvas.height = h
      const tempCtx = tempCanvas.getContext('2d')
      if (tempCtx) {
        const imgData = tempCtx.createImageData(w, h)
        const d = imgData.data
        for (let py = 0; py < h; py++) {
          const rowMaskOffset = py * maskRowBytes
          for (let px = 0; px < w; px++) {
            const maskByte = maskData[rowMaskOffset + (px >> 3)]
            const isOpaque = ((maskByte >> (7 - (px & 7))) & 1) !== 0
            const offset = (py * w + px) * 4
            d[offset + 0] = pixelData[offset + 0]
            d[offset + 1] = pixelData[offset + 1]
            d[offset + 2] = pixelData[offset + 2]
            d[offset + 3] = isOpaque ? 255 : 0
          }
        }
        tempCtx.putImageData(imgData, 0, 0)
        const dataUrl = tempCanvas.toDataURL('image/png')
        const hx = Math.max(0, Math.min(w - 1, hotspotX))
        const hy = Math.max(0, Math.min(h - 1, hotspotY))
        this.canvas.style.cursor = `url(${dataUrl}) ${hx} ${hy}, auto`
      }
    } catch {
      // 容错降级
      this.canvas.style.cursor = 'default'
    }

    this.consume(totalNeed)
    this.finishCurrentRect()
    return true
  }

  private finishCurrentRect(): void {
    this.currentRect = null
    this.pendingRects = Math.max(0, this.pendingRects - 1)
  }

  private sendSetPixelFormat(): void {
    const msg = new Uint8Array(20)
    msg[0] = 0 // SetPixelFormat
    msg[4] = 32 // bits-per-pixel = 32
    msg[5] = 24 // depth = 24
    msg[6] = 0  // big-endian-flag = 0 (little-endian)
    msg[7] = 1  // true-color-flag = 1
    // red-max = 255, green-max = 255, blue-max = 255
    msg[8] = 0
    msg[9] = 255
    msg[10] = 0
    msg[11] = 255
    msg[12] = 0
    msg[13] = 255
    // red-shift = 0, green-shift = 8, blue-shift = 16 -> 内存字节序恰好是 [R, G, B, X]
    msg[14] = 0
    msg[15] = 8
    msg[16] = 16
    this.sendRaw(msg)
  }

  private sendCurrentEncodings(): void {
    const encodings = [7, 1, 5, 2, 0, -308, -223, -239]
    switch (this.qualityPreset) {
      case 'fast':
        // 极速低延迟：更强压缩比 (level 8: -248), 降低 JPEG 质量 (level 2: -30)
        encodings.push(-248, -30)
        break
      case 'balanced':
        // 平衡推荐：标准压缩比 (level 6: -250), 适中 JPEG 质量 (level 6: -26)
        encodings.push(-250, -26)
        break
      case 'high':
        // 高清画质：标准压缩比 (level 6: -250), 高 JPEG 质量 (level 9: -23)
        encodings.push(-250, -23)
        break
      case 'lossless':
        // 无损原画：高压缩比 (level 7: -249), 不发送 JPEG 质量编码（禁用有损 JPEG，纯无损图块）
        encodings.push(-249)
        break
    }
    this.sendSetEncodings(encodings)
  }

  private sendSetEncodings(encodings: number[]): void {
    const msg = new Uint8Array(4 + encodings.length * 4)
    msg[0] = 2 // SetEncodings
    msg[2] = (encodings.length >> 8) & 0xff
    msg[3] = encodings.length & 0xff
    encodings.forEach((enc, idx) => {
      const off = 4 + idx * 4
      msg[off] = (enc >>> 24) & 0xff
      msg[off + 1] = (enc >>> 16) & 0xff
      msg[off + 2] = (enc >>> 8) & 0xff
      msg[off + 3] = enc & 0xff
    })
    this.sendRaw(msg)
  }

  private sendFramebufferUpdateRequest(
    incremental: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const msg = new Uint8Array(10)
    msg[0] = 3 // FramebufferUpdateRequest
    msg[1] = incremental ? 1 : 0
    msg[2] = (x >> 8) & 0xff
    msg[3] = x & 0xff
    msg[4] = (y >> 8) & 0xff
    msg[5] = y & 0xff
    msg[6] = (w >> 8) & 0xff
    msg[7] = w & 0xff
    msg[8] = (h >> 8) & 0xff
    msg[9] = h & 0xff
    this.sendRaw(msg)
  }
}
