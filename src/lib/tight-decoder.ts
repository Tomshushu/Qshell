/**
 * RFB Tight 压缩编码解码器 (RFC 6143 & TightVNC Specification)
 *
 * 核心特性：
 * 1. 维护 4 个持久化 zlib inflate 字典解压流 (Stream 0..3)，实现跨帧高压缩比（25:1 ~ 30:1）；
 * 2. 支持 Solid Color (Fill 填充)、Mono 2-Color Palette、Multi (3..256) Color Palette；
 * 3. 支持 Gradient 二维差分预测渐变滤镜与 Copy 无滤镜流；
 * 4. 支持 Compact Length 变长压缩字节头解析。
 */

import pako from 'pako'

export const TIGHT_SUBENCODING_FILL = 0x08
export const TIGHT_SUBENCODING_JPEG = 0x09
export const TIGHT_FILTER_COPY = 0
export const TIGHT_FILTER_PALETTE = 1
export const TIGHT_FILTER_GRADIENT = 2

export interface TightRectHeader {
  compCtl: number
  subencoding: number
  streamId: number
  explicitFilter: boolean
  filterId: number
}

export class TightDecoder {
  private zlibStreams: (pako.Inflate | null)[] = [null, null, null, null]
  private streamChunks: Uint8Array[][] = [[], [], [], []]

  public resetStream(streamId: number): void {
    if (streamId >= 0 && streamId < 4) {
      this.zlibStreams[streamId] = null
      this.streamChunks[streamId] = []
    }
  }

  public resetAllStreams(): void {
    for (let i = 0; i < 4; i++) {
      this.zlibStreams[i] = null
      this.streamChunks[i] = []
    }
  }

  /**
   * 解压指定 streamId 的压缩块并保持字典上下文
   */
  public decompress(streamId: number, compressedData: Uint8Array, expectedSize: number): Uint8Array {
    if (streamId < 0 || streamId > 3) {
      throw new Error(`Invalid Tight zlib stream id: ${streamId}`)
    }

    if (!this.zlibStreams[streamId]) {
      const inf = new pako.Inflate({
        chunkSize: Math.max(32768, expectedSize),
      })
      inf.onData = (chunk: Uint8Array) => {
        this.streamChunks[streamId].push(chunk)
      }
      this.zlibStreams[streamId] = inf
    }

    this.streamChunks[streamId] = []
    const inf = this.zlibStreams[streamId]!
    inf.push(compressedData, pako.Z_SYNC_FLUSH)

    if (inf.err) {
      this.resetStream(streamId)
      throw new Error(`Tight zlib inflate failed (stream ${streamId}): ${inf.msg || inf.err}`)
    }

    const chunks = this.streamChunks[streamId]
    if (chunks.length === 1) {
      return chunks[0]
    }
    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
    const out = new Uint8Array(totalLen)
    let offset = 0
    for (const c of chunks) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

  /**
   * 解析 Compact Length 变长字节头（1~3 字节）
   */
  public static readCompactLength(
    buf: Uint8Array,
    offset: number
  ): { length: number; bytesRead: number } | null {
    if (buf.length < offset + 1) return null
    let b = buf[offset]
    let length = b & 0x7f
    let bytesRead = 1

    if ((b & 0x80) !== 0) {
      if (buf.length < offset + 2) return null
      b = buf[offset + 1]
      length |= (b & 0x7f) << 7
      bytesRead = 2

      if ((b & 0x80) !== 0) {
        if (buf.length < offset + 3) return null
        b = buf[offset + 2]
        length |= (b & 0xff) << 14
        bytesRead = 3
      }
    }

    return { length, bytesRead }
  }

  /**
   * 渐变差分预测滤镜还原 (Gradient Filter)
   * 公式：R = DiffR + clamp(LeftR + TopR - DiagR)
   */
  public static decodeGradient(
    src: Uint8Array,
    dst: Uint8Array,
    width: number,
    height: number
  ): void {
    let srcIdx = 0
    let dstIdx = 0

    const prevRowR = new Uint8Array(width)
    const prevRowG = new Uint8Array(width)
    const prevRowB = new Uint8Array(width)

    for (let y = 0; y < height; y++) {
      let leftR = 0
      let leftG = 0
      let leftB = 0
      let diagR = 0
      let diagG = 0
      let diagB = 0

      for (let x = 0; x < width; x++) {
        const topR = prevRowR[x]
        const topG = prevRowG[x]
        const topB = prevRowB[x]

        let predR = leftR + topR - diagR
        let predG = leftG + topG - diagG
        let predB = leftB + topB - diagB

        if (predR < 0) predR = 0
        else if (predR > 255) predR = 255
        if (predG < 0) predG = 0
        else if (predG > 255) predG = 255
        if (predB < 0) predB = 0
        else if (predB > 255) predB = 255

        const r = (predR + src[srcIdx++]) & 0xff
        const g = (predG + src[srcIdx++]) & 0xff
        const b = (predB + src[srcIdx++]) & 0xff

        dst[dstIdx++] = r
        dst[dstIdx++] = g
        dst[dstIdx++] = b
        dst[dstIdx++] = 255

        diagR = topR
        diagG = topG
        diagB = topB
        leftR = r
        leftG = g
        leftB = b
        prevRowR[x] = r
        prevRowG[x] = g
        prevRowB[x] = b
      }
    }
  }

  /**
   * 2色单色调色板解码（1 bit 对应 1 像素，每行按 8 bit 字节对齐）
   */
  public static decodeMonoPalette(
    src: Uint8Array,
    dst: Uint8Array,
    width: number,
    height: number,
    palette: Uint8Array // 6 字节 (2 * 3)
  ): void {
    let srcIdx = 0
    let dstIdx = 0
    const rowBytes = Math.floor((width + 7) / 8)

    for (let y = 0; y < height; y++) {
      const rowStart = srcIdx
      for (let x = 0; x < width; x++) {
        const byteOffset = rowStart + (x >> 3)
        const bitOffset = 7 - (x & 7)
        const bit = (src[byteOffset] >> bitOffset) & 1
        const pOffset = bit * 3

        dst[dstIdx++] = palette[pOffset]
        dst[dstIdx++] = palette[pOffset + 1]
        dst[dstIdx++] = palette[pOffset + 2]
        dst[dstIdx++] = 255
      }
      srcIdx += rowBytes
    }
  }

  /**
   * 3..256 色调色板解码（1 byte 对应 1 像素索引）
   */
  public static decodeMultiPalette(
    src: Uint8Array,
    dst: Uint8Array,
    pixelCount: number,
    palette: Uint8Array // numColors * 3
  ): void {
    let dstIdx = 0
    for (let i = 0; i < pixelCount; i++) {
      const colorIdx = src[i]
      const pOffset = colorIdx * 3

      dst[dstIdx++] = palette[pOffset]
      dst[dstIdx++] = palette[pOffset + 1]
      dst[dstIdx++] = palette[pOffset + 2]
      dst[dstIdx++] = 255
    }
  }

  /**
   * 无滤镜原始 24-bit RGB 还原为 32-bit RGBA
   */
  public static decodeRawRgb(
    src: Uint8Array,
    dst: Uint8Array,
    pixelCount: number
  ): void {
    let srcIdx = 0
    let dstIdx = 0
    for (let i = 0; i < pixelCount; i++) {
      dst[dstIdx++] = src[srcIdx++]
      dst[dstIdx++] = src[srcIdx++]
      dst[dstIdx++] = src[srcIdx++]
      dst[dstIdx++] = 255
    }
  }
}
