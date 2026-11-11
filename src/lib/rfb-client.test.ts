import { describe, expect, it } from 'vitest'
import { vncDesEncryptChallenge, domEventToKeysym } from './rfb-client'

describe('rfb-client protocol primitives', () => {
  it('encrypts 16-byte VNC challenge deterministically with bit-reversed DES key', () => {
    const challenge = new Uint8Array([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
      0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
    ])
    const res1 = vncDesEncryptChallenge(challenge, 'secret12')
    const res2 = vncDesEncryptChallenge(challenge, 'secret12')
    const resDiff = vncDesEncryptChallenge(challenge, 'otherpwd')

    expect(res1).toHaveLength(16)
    expect(res1).toEqual(res2)
    expect(res1).not.toEqual(resDiff)
  })

  it('maps special keys and printable characters to X11 keysyms', () => {
    expect(domEventToKeysym({ code: 'Enter', key: 'Enter' } as KeyboardEvent)).toBe(0xff0d)
    expect(domEventToKeysym({ code: 'Backspace', key: 'Backspace' } as KeyboardEvent)).toBe(0xff08)
    expect(domEventToKeysym({ code: 'KeyA', key: 'a' } as KeyboardEvent)).toBe(97)
    expect(domEventToKeysym({ code: 'KeyA', key: 'A' } as KeyboardEvent)).toBe(65)
    expect(domEventToKeysym({ code: 'Tab', key: 'Tab' } as KeyboardEvent)).toBe(0xff09)
    expect(domEventToKeysym({ code: 'MetaLeft', key: 'Meta' } as KeyboardEvent)).toBe(0xffe7)
    // 中文 Unicode 字符穿透映射
    expect(domEventToKeysym({ code: '', key: '中' } as KeyboardEvent)).toBe(0x01000000 | '中'.charCodeAt(0))
  })
})

describe('rfb-client handshake state machine and error handling', () => {
  it('correctly catches and reports "Too many security failures" without getting overwritten by onclose', async () => {
    // 模拟 Canvas 和上下文
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let latestStatus = ''
    let latestMsg: string | undefined = ''

    const { RfbClient } = await import('./rfb-client')
    const client = new RfbClient(canvas, '1234@qwe', {
      onStatusChange: (status, msg) => {
        latestStatus = status
        latestMsg = msg
      },
    })

    // 模拟 WebSocket
    class MockWebSocket {
      public readyState = 1 // WebSocket.OPEN
      public onopen: (() => void) | null = null
      public onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      public onerror: (() => void) | null = null
      public onclose: (() => void) | null = null
      public sent: Uint8Array[] = []

      send(data: ArrayBuffer | Uint8Array) {
        if (data instanceof Uint8Array) {
          this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        } else {
          this.sent.push(new Uint8Array(data))
        }
      }

      close() {
        this.onclose?.()
      }
    }

    const mockWs = new MockWebSocket()
    function MockWebSocketCtor() {
      return mockWs
    }
    MockWebSocketCtor.OPEN = 1
    MockWebSocketCtor.CONNECTING = 0
    MockWebSocketCtor.CLOSING = 2
    MockWebSocketCtor.CLOSED = 3
    // @ts-expect-error Mocking global WebSocket
    globalThis.WebSocket = MockWebSocketCtor

    client.connect('ws://127.0.0.1:9999/vnc')
    expect(latestStatus).toBe('connecting')

    mockWs.onopen?.()
    expect(latestStatus).toBe('handshaking')

    // 1. 服务端下发 RFB 003.008\n
    mockWs.onmessage?.({ data: new TextEncoder().encode('RFB 003.008\n').buffer })
    // 客户端应回复 RFB 003.008\n
    expect(new TextDecoder().decode(mockWs.sent[0])).toBe('RFB 003.008\n')

    // 2. 服务端下发 count=0 且 reason="Too many security failures" (RFC 6143 格式)
    const reasonText = 'Too many security failures'
    const reasonBuf = new TextEncoder().encode(reasonText)
    const errPayload = new Uint8Array(1 + 4 + reasonBuf.length)
    errPayload[0] = 0 // count = 0
    const view = new DataView(errPayload.buffer)
    view.setUint32(1, reasonBuf.length) // reason length (4 bytes BE)
    errPayload.set(reasonBuf, 5)

    mockWs.onmessage?.({ data: errPayload.buffer })

    // 此时由于服务端断开连接，触发 ws.close()
    mockWs.close()

    // 校验：错误必须清晰呈现为服务端返回的真实原因，绝不能被通用文案掩盖
    expect(latestStatus).toBe('error')
    expect(latestMsg).toContain('Too many security failures')
  })

  it('completes VncAuth (DES) challenge-response authentication and reaches connected state', async () => {
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let latestStatus = ''
    let latestDesktopInfo: { width: number; height: number; name: string } | null = null
    let latestStats: import('./rfb-client').VncSessionStats | null = null

    const { RfbClient } = await import('./rfb-client')
    const client = new RfbClient(canvas, '1234@qwe', {
      onStatusChange: (status) => {
        latestStatus = status
      },
      onDesktopInfo: (info) => {
        latestDesktopInfo = info
      },
      onStats: (stats) => {
        latestStats = stats
      },
    })

    class MockWebSocket {
      public readyState = 1
      public onopen: (() => void) | null = null
      public onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      public sent: Uint8Array[] = []

      send(data: ArrayBuffer | Uint8Array) {
        if (data instanceof Uint8Array) {
          this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        } else {
          this.sent.push(new Uint8Array(data))
        }
      }

      close() {}
    }

    const mockWs = new MockWebSocket()
    function MockWebSocketCtor() {
      return mockWs
    }
    MockWebSocketCtor.OPEN = 1
    // @ts-expect-error Mock
    globalThis.WebSocket = MockWebSocketCtor

    client.connect('ws://127.0.0.1:9999/vnc')
    mockWs.onopen?.()

    // 1. 服务端下发 RFB 003.008\n
    mockWs.onmessage?.({ data: new TextEncoder().encode('RFB 003.008\n').buffer })
    expect(new TextDecoder().decode(mockWs.sent[0])).toBe('RFB 003.008\n')

    // 2. 服务端下发 1 个安全类型：类型 2 (VncAuth)
    mockWs.onmessage?.({ data: new Uint8Array([1, 2]).buffer })
    // 客户端应选择类型 2
    expect(mockWs.sent[1]).toEqual(new Uint8Array([2]))
    expect(latestStatus).toBe('authenticating')

    // 3. 服务端下发 16 字节挑战码
    const challenge = new Uint8Array(16).fill(0x42)
    mockWs.onmessage?.({ data: challenge.buffer })
    // 客户端回复 16 字节加密密文
    expect(mockWs.sent[2]).toHaveLength(16)

    // 4. 服务端下发认证成功 (0x00000000)
    const successRes = new Uint8Array([0, 0, 0, 0])
    mockWs.onmessage?.({ data: successRes.buffer })
    // 客户端发送 ClientInit (shared=1)
    expect(mockWs.sent[3]).toEqual(new Uint8Array([1]))

    // 5. 服务端下发 ServerInit (800x600, desktop name: "Ubuntu Desktop")
    const nameBytes = new TextEncoder().encode('Ubuntu Desktop')
    const serverInit = new Uint8Array(24 + nameBytes.length)
    const v = new DataView(serverInit.buffer)
    v.setUint16(0, 800) // width
    v.setUint16(2, 600) // height
    v.setUint8(4, 32)   // bpp
    v.setUint8(5, 24)   // depth
    v.setUint8(6, 0)    // big-endian
    v.setUint8(7, 1)    // true-colour
    v.setUint16(8, 255) // red-max
    v.setUint16(10, 255)// green-max
    v.setUint16(12, 255)// blue-max
    v.setUint8(14, 0)   // red-shift
    v.setUint8(15, 8)   // green-shift
    v.setUint8(16, 16)  // blue-shift
    v.setUint32(20, nameBytes.length)
    serverInit.set(nameBytes, 24)

    mockWs.onmessage?.({ data: serverInit.buffer })

    // 校验：成功进入 connected 状态并解析出桌面信息
    expect(latestStatus).toBe('connected')
    expect(latestDesktopInfo).toEqual({
      width: 800,
      height: 600,
      name: 'Ubuntu Desktop',
    })

    // 6. 服务端下发 Cursor 伪编码 (-239) 矩形：测试空光标 (w=0, h=0) 隐藏光标
    const cursorHeader = new Uint8Array(4 + 12)
    const cv = new DataView(cursorHeader.buffer)
    cursorHeader[0] = 0 // FramebufferUpdate
    cv.setUint16(2, 1)  // 1 个矩形
    cv.setUint16(4, 0)  // x (hotspotX) = 0
    cv.setUint16(6, 0)  // y (hotspotY) = 0
    cv.setUint16(8, 0)  // w = 0
    cv.setUint16(10, 0) // h = 0
    cv.setInt32(12, -239) // Cursor pseudo-encoding
    mockWs.onmessage?.({ data: cursorHeader.buffer })

    expect((canvas as unknown as { style: { cursor: string } }).style.cursor).toBe('none')

    // 7. 服务端下发 Tight (7) 编码的 Fill 纯色填充矩形
    const fillRect = new Uint8Array(4 + 12 + 4)
    const fv = new DataView(fillRect.buffer)
    fillRect[0] = 0 // FramebufferUpdate
    fv.setUint16(2, 1) // 1 个矩形
    fv.setUint16(4, 10) // x = 10
    fv.setUint16(6, 20) // y = 20
    fv.setUint16(8, 100) // w = 100
    fv.setUint16(10, 50) // h = 50
    fv.setInt32(12, 7) // Tight Encoding
    fillRect[16] = 0x80 // compCtl: subencoding = 0x08 (Fill), no reset
    fillRect[17] = 255 // R
    fillRect[18] = 128 // G
    fillRect[19] = 64  // B
    mockWs.onmessage?.({ data: fillRect.buffer })

    // 校验：处理完矩形后应向服务端发送 FramebufferUpdateRequest (增量)
    const lastSent = mockWs.sent[mockWs.sent.length - 1]
    expect(lastSent[0]).toBe(3) // FramebufferUpdateRequest
    expect(lastSent[1]).toBe(1) // incremental = true

    // 8. 测试客户端向服务端请求动态改变分辨率 (Type 251 SetDesktopSize)
    client.requestDesktopSize(1600, 900)
    const sentCountBefore = mockWs.sent.length
    const setSizeMsg = mockWs.sent[mockWs.sent.length - 1]
    expect(setSizeMsg).toHaveLength(24)
    expect(setSizeMsg[0]).toBe(251) // Type 251
    const sv = new DataView(setSizeMsg.buffer)
    expect(sv.getUint16(2)).toBe(1600) // width
    expect(sv.getUint16(4)).toBe(900)  // height
    expect(setSizeMsg[6]).toBe(1)      // numberOfScreens = 1

    // 8.1 再次重复请求相同尺寸（在途幂等防重拦截，防止重复触发两段式刷屏）
    client.requestDesktopSize(1600, 900)
    expect(mockWs.sent.length).toBe(sentCountBefore)

    // 9. 服务端响应 ExtendedDesktopSize (-308) 矩形（包含 1 个 screen 的 payload）
    const extDesktopRect = new Uint8Array(4 + 12 + 4 + 16)
    const ev = new DataView(extDesktopRect.buffer)
    extDesktopRect[0] = 0 // FramebufferUpdate
    ev.setUint16(2, 1)   // 1 个矩形
    ev.setUint16(4, 1)   // x = 1 (client requested)
    ev.setUint16(6, 0)   // y = 0 (success)
    ev.setUint16(8, 1600) // new width
    ev.setUint16(10, 900) // new height
    ev.setInt32(12, -308) // ExtendedDesktopSize (-308)
    extDesktopRect[16] = 1 // numberOfScreens = 1
    mockWs.onmessage?.({ data: extDesktopRect.buffer })

    expect(latestDesktopInfo).toEqual({
      width: 1600,
      height: 900,
      name: 'Ubuntu Desktop',
    })

    // 10. 测试动态切换 Tight 传输画质档位 (SetEncodings + Pseudo-encodings)
    expect(client.getQualityPreset()).toBe('balanced')
    client.setQualityPreset('fast')
    expect(client.getQualityPreset()).toBe('fast')

    // 查找最后发出的 SetEncodings (Type 2) 报文
    const encMsg = mockWs.sent.slice().reverse().find((m) => m[0] === 2 && m.length > 4)
    expect(encMsg).toBeDefined()
    if (encMsg) {
      const numEnc = (encMsg[2] << 8) | encMsg[3]
      const encList: number[] = []
      const dvEnc = new DataView(encMsg.buffer, encMsg.byteOffset, encMsg.byteLength)
      for (let i = 0; i < numEnc; i++) {
        encList.push(dvEnc.getInt32(4 + i * 4))
      }
      // 'fast' 包含 Tight(7) 以及压缩级别 8 (-248) 与 JPEG quality 2 (-30)
      expect(encList).toContain(7)
      expect(encList).toContain(-248)
      expect(encList).toContain(-30)
    }

    // 11. 断开连接并清理性能探针定时器
    client.disconnect()
    expect(latestStatus).toBe('connected') // 状态保持或转关闭
  })

  it('delegates VncAuth challenge computation via onAuthChallenge without client password', async () => {
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let latestStatus = ''
    let challengeReceivedByDelegate: Uint8Array | null = null

    const { RfbClient, vncDesEncryptChallenge } = await import('./rfb-client')
    const client = new RfbClient(canvas, '', {
      onStatusChange: (status) => {
        latestStatus = status
      },
      onAuthChallenge: async (challenge) => {
        challengeReceivedByDelegate = challenge
        // 模拟 Rust 后端安全代算：使用隔离区密码计算
        return vncDesEncryptChallenge(challenge, 'backend_secret')
      },
    })

    class MockWebSocket {
      public readyState = 1
      public onopen: (() => void) | null = null
      public onmessage: ((e: { data: ArrayBuffer | Uint8Array }) => void) | null = null
      public onerror: ((e: unknown) => void) | null = null
      public onclose: (() => void) | null = null
      public sent: Uint8Array[] = []
      public binaryType = 'arraybuffer'

      public send(data: ArrayBuffer | Uint8Array) {
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
        this.sent.push(u8)
      }
      public close() {
        this.readyState = 3
        this.onclose?.()
      }
    }

    const mockWs = new MockWebSocket()
    function MockWebSocketCtor() {
      return mockWs
    }
    MockWebSocketCtor.OPEN = 1
    // @ts-expect-error Mock
    globalThis.WebSocket = MockWebSocketCtor

    client.connect('ws://127.0.0.1:9999/vnc')
    mockWs.onopen?.()

    // 1. 服务端下发 RFB 3.8 版本头
    await mockWs.onmessage?.({ data: new TextEncoder().encode('RFB 003.008\n').buffer })
    expect(new TextDecoder().decode(mockWs.sent[0])).toBe('RFB 003.008\n')

    // 2. 服务端下发安全类型列表：仅支持 VNC Auth (2)
    await mockWs.onmessage?.({ data: new Uint8Array([1, 2]).buffer })
    expect(mockWs.sent[1]).toEqual(new Uint8Array([2]))

    // 3. 服务端下发 16 字节随机挑战
    const rawChallenge = new Uint8Array(16).fill(0x77)
    await mockWs.onmessage?.({ data: rawChallenge.buffer })

    // 等待异步委托代算完成
    await new Promise((r) => setTimeout(r, 20))

    // 校验：挑战已成功委托给 onAuthChallenge 且前端发出了代算密文
    expect(challengeReceivedByDelegate).toEqual(rawChallenge)
    expect(mockWs.sent.length).toBeGreaterThanOrEqual(3)
    const expectedResp = vncDesEncryptChallenge(rawChallenge, 'backend_secret')
    expect(mockWs.sent[2]).toEqual(expectedResp)

    // 4. 服务端下发 SecurityResult (0 = OK)
    await mockWs.onmessage?.({ data: new Uint8Array([0, 0, 0, 0]).buffer })
    // 5. 校验客户端发出 ClientInit (1)
    expect(mockWs.sent[3]).toEqual(new Uint8Array([1]))

    client.disconnect()
  })

  it('triggers password_required when no password and no onAuthChallenge callback provided', async () => {
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let latestStatus = ''
    const { RfbClient } = await import('./rfb-client')
    const client = new RfbClient(canvas, '', {
      onStatusChange: (status) => {
        latestStatus = status
      },
    })

    class MockWebSocket {
      public readyState = 1
      public onopen: (() => void) | null = null
      public onmessage: ((e: { data: ArrayBuffer | Uint8Array }) => void) | null = null
      public onerror: ((e: unknown) => void) | null = null
      public onclose: (() => void) | null = null
      public sent: Uint8Array[] = []
      public binaryType = 'arraybuffer'

      public send(data: ArrayBuffer | Uint8Array) {
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
        this.sent.push(u8)
      }
      public close() {
        this.readyState = 3
        this.onclose?.()
      }
    }

    const mockWs = new MockWebSocket()
    function MockWebSocketCtor() {
      return mockWs
    }
    MockWebSocketCtor.OPEN = 1
    // @ts-expect-error Mock
    globalThis.WebSocket = MockWebSocketCtor

    client.connect('ws://127.0.0.1:9999/vnc')
    mockWs.onopen?.()

    await mockWs.onmessage?.({ data: new TextEncoder().encode('RFB 003.008\n').buffer })
    await mockWs.onmessage?.({ data: new Uint8Array([1, 2]).buffer })
    await mockWs.onmessage?.({ data: new Uint8Array(16).fill(0x55).buffer })

    expect(latestStatus).toBe('password_required')
    client.disconnect()
  })

  it('negotiates VeNCrypt 0.2 Plain subtype handshake successfully', async () => {
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let latestStatus = ''
    const { RfbClient } = await import('./rfb-client')
    const client = new RfbClient(canvas, 'mypassword', {
      onStatusChange: (status) => {
        latestStatus = status
      },
    })

    class MockWs {
      public readyState = 1
      public onopen: (() => void) | null = null
      public onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      public sent: Uint8Array[] = []
      send(data: ArrayBuffer | Uint8Array) {
        if (data instanceof Uint8Array) {
          this.sent.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        } else {
          this.sent.push(new Uint8Array(data))
        }
      }
      close() {}
    }

    const mockWs = new MockWs()
    function MockWebSocketCtor() {
      return mockWs
    }
    MockWebSocketCtor.OPEN = 1
    MockWebSocketCtor.CONNECTING = 0
    MockWebSocketCtor.CLOSING = 2
    MockWebSocketCtor.CLOSED = 3
    // @ts-expect-error Mocking global WebSocket
    globalThis.WebSocket = MockWebSocketCtor

    client.connect('ws://127.0.0.1:9999/vnc')
    mockWs.onopen?.()

    // 1. 服务端下发 RFB 003.008\n
    mockWs.onmessage?.({ data: new TextEncoder().encode('RFB 003.008\n').buffer })
    expect(new TextDecoder().decode(mockWs.sent[0])).toBe('RFB 003.008\n')

    // 2. 服务端下发安全类型仅包含 19 (VeNCrypt)
    mockWs.onmessage?.({ data: new Uint8Array([1, 19]).buffer })
    // 客户端回复选择 19
    const lastSent1 = mockWs.sent[mockWs.sent.length - 1]
    expect(lastSent1[0]).toBe(19)

    // 3. 服务端发送 VeNCrypt 版本 [0, 2]
    mockWs.onmessage?.({ data: new Uint8Array([0, 2]).buffer })
    // 客户端回复确认 [0, 2]
    const lastSent2 = mockWs.sent[mockWs.sent.length - 1]
    expect(lastSent2).toEqual(new Uint8Array([0, 2]))

    // 4. 服务端发送版本确认 [0] (OK)
    mockWs.onmessage?.({ data: new Uint8Array([0]).buffer })

    // 5. 服务端发送子类型列表包含 256 (Plain)
    const subPayload = new Uint8Array(1 + 4)
    subPayload[0] = 1 // 1 个子类型
    const dv = new DataView(subPayload.buffer)
    dv.setUint32(1, 256) // 256 = Plain
    mockWs.onmessage?.({ data: subPayload.buffer })

    // 客户端应选择 256 并发送凭证
    const credSent = mockWs.sent[mockWs.sent.length - 1]
    expect(credSent.length).toBeGreaterThan(8) // 包含 8 字节长度头 + 密码

    // 6. 服务端发送 SecurityResult: OK (0)
    mockWs.onmessage?.({ data: new Uint8Array([0, 0, 0, 0]).buffer })

    // 客户端进入 ClientInit / ServerInit
    const initSent = mockWs.sent[mockWs.sent.length - 1]
    expect(initSent).toEqual(new Uint8Array([1])) // ClientInit shared=1

    // 7. 发送 ServerInit 假响应完成连接
    const serverInit = new Uint8Array(24)
    const sidv = new DataView(serverInit.buffer)
    sidv.setUint16(0, 800)
    sidv.setUint16(2, 600)
    sidv.setUint8(4, 32) // bpp
    sidv.setUint8(5, 24) // depth
    sidv.setUint8(6, 0)  // big-endian
    sidv.setUint8(7, 1)  // true-color
    sidv.setUint16(8, 255)
    sidv.setUint16(10, 255)
    sidv.setUint16(12, 255)
    sidv.setUint8(14, 16)
    sidv.setUint8(15, 8)
    sidv.setUint8(16, 0)
    sidv.setUint32(20, 0) // name length
    mockWs.onmessage?.({ data: serverInit.buffer })

    expect(client.getStatus()).toBe('connected')

    // 测试 sendText 发送中文及回车
    const sentBefore = mockWs.sent.length
    client.sendText('好\n')
    // '好' -> 1 down + 1 up, '\n' -> 1 down + 1 up = 4 KeyEvents
    expect(mockWs.sent.length - sentBefore).toBe(4)

    const key1Down = mockWs.sent[sentBefore]
    expect(key1Down[0]).toBe(4) // KeyEvent
    expect(key1Down[1]).toBe(1) // down = 1
    const key1Sym = (key1Down[4] << 24) | (key1Down[5] << 16) | (key1Down[6] << 8) | key1Down[7]
    expect(key1Sym).toBe(0x01000000 | '好'.charCodeAt(0))

    const key2Down = mockWs.sent[sentBefore + 2]
    expect(key2Down[0]).toBe(4) // KeyEvent
    expect(key2Down[1]).toBe(1) // down = 1
    const key2Sym = (key2Down[4] << 24) | (key2Down[5] << 16) | (key2Down[6] << 8) | key2Down[7]
    expect(key2Sym).toBe(0xff0d) // Return

    client.disconnect()
  })

  it('safely catches malformed frame and resets rx buffer without crashing', async () => {
    const canvas = {
      getContext: () => ({
        createImageData: () => ({ data: new Uint8Array(4) }),
        putImageData: () => {},
        fillRect: () => {},
      }),
      width: 0,
      height: 0,
      style: { cursor: '' },
    } as unknown as HTMLCanvasElement

    let errorReason = ''
    let latestStatus = ''
    const { RfbClient } = await import('./rfb-client')
    const client = new RfbClient(canvas, 'password', {
      onStatusChange: (status, reason) => {
        latestStatus = status
        if (reason) errorReason = reason
      },
    })

    class MockWs {
      public readyState = 1
      public onopen: (() => void) | null = null
      public onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null
      public closeCalled = false
      send() {}
      close() {
        this.closeCalled = true
      }
    }

    const mockWs = new MockWs()
    // @ts-expect-error Mock WebSocket
    globalThis.WebSocket = function () {
      return mockWs
    }

    client.connect('ws://127.0.0.1:9999/vnc')
    mockWs.onopen?.()

    // 发送非法的协议版本帧（不是以 'RFB ' 开头）
    const malformedBanner = new TextEncoder().encode('BOGUS 003.008\n')
    mockWs.onmessage?.({ data: malformedBanner.buffer })

    expect(latestStatus).toBe('error')
    expect(errorReason).toContain('无效的 RFB 握手头')
    expect(mockWs.closeCalled).toBe(true)

    client.disconnect()
  })
})
