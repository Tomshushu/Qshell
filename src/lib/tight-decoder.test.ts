import { describe, it, expect } from 'vitest'
import pako from 'pako'
import {
  TightDecoder,
  TIGHT_SUBENCODING_FILL,
  TIGHT_FILTER_PALETTE,
  TIGHT_FILTER_GRADIENT,
} from './tight-decoder'

describe('TightDecoder', () => {
  it('should correctly parse 1-byte, 2-byte, and 3-byte Compact Length', () => {
    // 1-byte: 0x7f = 127
    const buf1 = new Uint8Array([0x7f])
    expect(TightDecoder.readCompactLength(buf1, 0)).toEqual({ length: 127, bytesRead: 1 })

    // 2-byte: 0x80, 0x01 = 128
    const buf2 = new Uint8Array([0x80, 0x01])
    expect(TightDecoder.readCompactLength(buf2, 0)).toEqual({ length: 128, bytesRead: 2 })

    // 3-byte: 0x80, 0x80, 0x01 = 16384
    const buf3 = new Uint8Array([0x80, 0x80, 0x01])
    expect(TightDecoder.readCompactLength(buf3, 0)).toEqual({ length: 16384, bytesRead: 3 })
  })

  it('should correctly decode 2-color Mono Palette', () => {
    // 2x2 image, palette: Color 0 = Red (255, 0, 0), Color 1 = Blue (0, 0, 255)
    const palette = new Uint8Array([255, 0, 0, 0, 0, 255])
    // 2x2: rowBytes = ceil(2/8) = 1 byte per row.
    // Row 0: pixel 0 = bit 7 (1 = Blue), pixel 1 = bit 6 (0 = Red) -> 0b10000000 = 0x80
    // Row 1: pixel 0 = bit 7 (0 = Red), pixel 1 = bit 6 (1 = Blue) -> 0b01000000 = 0x40
    const src = new Uint8Array([0x80, 0x40])
    const dst = new Uint8Array(2 * 2 * 4)

    TightDecoder.decodeMonoPalette(src, dst, 2, 2, palette)

    // Pixel (0, 0): Blue
    expect(dst[0]).toBe(0)
    expect(dst[1]).toBe(0)
    expect(dst[2]).toBe(255)
    expect(dst[3]).toBe(255)

    // Pixel (1, 0): Red
    expect(dst[4]).toBe(255)
    expect(dst[5]).toBe(0)
    expect(dst[6]).toBe(0)
    expect(dst[7]).toBe(255)

    // Pixel (0, 1): Red
    expect(dst[8]).toBe(255)
    expect(dst[9]).toBe(0)
    expect(dst[10]).toBe(0)
    expect(dst[11]).toBe(255)

    // Pixel (1, 1): Blue
    expect(dst[12]).toBe(0)
    expect(dst[13]).toBe(0)
    expect(dst[14]).toBe(255)
    expect(dst[15]).toBe(255)
  })

  it('should correctly decode Multi Palette (3..256 colors)', () => {
    // 3 colors: C0=(10,10,10), C1=(20,20,20), C2=(30,30,30)
    const palette = new Uint8Array([10, 10, 10, 20, 20, 20, 30, 30, 30])
    const indices = new Uint8Array([2, 0, 1])
    const dst = new Uint8Array(3 * 4)

    TightDecoder.decodeMultiPalette(indices, dst, 3, palette)

    // P0 -> C2 (30,30,30)
    expect(Array.from(dst.subarray(0, 4))).toEqual([30, 30, 30, 255])
    // P1 -> C0 (10,10,10)
    expect(Array.from(dst.subarray(4, 8))).toEqual([10, 10, 10, 255])
    // P2 -> C1 (20,20,20)
    expect(Array.from(dst.subarray(8, 12))).toEqual([20, 20, 20, 255])
  })

  it('should correctly decode Gradient Filter', () => {
    // 2x2 flat color 100, 100, 100
    // Origin (0,0) has diff 100
    // Remaining pixels have diff 0 because prediction matches perfectly!
    const src = new Uint8Array([
      100, 100, 100, // (0,0) diff
      0, 0, 0,       // (1,0) diff (pred=100 => 100+0=100)
      0, 0, 0,       // (0,1) diff (pred=100 => 100+0=100)
      0, 0, 0,       // (1,1) diff (pred=100+100-100=100 => 100+0=100)
    ])
    const dst = new Uint8Array(2 * 2 * 4)

    TightDecoder.decodeGradient(src, dst, 2, 2)

    for (let i = 0; i < 4; i++) {
      expect(dst[i * 4]).toBe(100)
      expect(dst[i * 4 + 1]).toBe(100)
      expect(dst[i * 4 + 2]).toBe(100)
      expect(dst[i * 4 + 3]).toBe(255)
    }
  })

  it('should decompress zlib stream maintaining dictionary state across chunks', () => {
    const decoder = new TightDecoder()

    // 模拟服务端在同一 streamId 上用 Z_SYNC_FLUSH 连续压缩两个包
    const def = new pako.Deflate()
    def.push(new Uint8Array([1, 2, 3, 4, 5]), pako.Z_SYNC_FLUSH)
    const chunk1 = def.result as Uint8Array

    def.push(new Uint8Array([6, 7, 8, 9, 10]), pako.Z_SYNC_FLUSH)
    const chunk2 = def.result as Uint8Array

    const out1 = decoder.decompress(0, chunk1, 5)
    expect(Array.from(out1)).toEqual([1, 2, 3, 4, 5])

    const out2 = decoder.decompress(0, chunk2, 5)
    expect(Array.from(out2)).toEqual([6, 7, 8, 9, 10])

    // 测试 resetStream
    decoder.resetStream(0)
    const defNew = new pako.Deflate()
    defNew.push(new Uint8Array([99]), pako.Z_SYNC_FLUSH)
    const chunkNew = defNew.result as Uint8Array
    const outNew = decoder.decompress(0, chunkNew, 1)
    expect(Array.from(outNew)).toEqual([99])
  })
})
