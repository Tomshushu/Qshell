import { describe, expect, it, vi } from 'vitest'
import { createRfbRenderer, RfbCanvas2dRenderer, RfbWebGlRenderer } from './rfb-renderer'

describe('RfbRenderer pipeline', () => {
  it('instantiates RfbCanvas2dRenderer and handles draw commands cleanly', () => {
    const putImageData = vi.fn()
    const fillRect = vi.fn()
    const drawImage = vi.fn()
    const createImageData = vi.fn((w: number, h: number) => ({
      data: new Uint8Array(w * h * 4),
      width: w,
      height: h,
    }))

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(),
    } as unknown as HTMLCanvasElement

    const ctx = {
      fillStyle: '',
      fillRect,
      drawImage,
      createImageData,
      putImageData,
    } as unknown as CanvasRenderingContext2D

    const renderer = new RfbCanvas2dRenderer(canvas, ctx)
    expect(renderer.mode).toBe('canvas2d')

    renderer.init(800, 600)
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
    expect(fillRect).toHaveBeenCalledWith(0, 0, 800, 600)

    // 测试画局部 Raw 像素
    const raw = new Uint8Array(16 * 16 * 4).fill(128)
    renderer.paintRawPixels(10, 20, 16, 16, raw)
    expect(createImageData).toHaveBeenCalledWith(16, 16)
    expect(putImageData).toHaveBeenCalled()

    // 测试 fillRect
    renderer.fillRect(5, 5, 20, 20, 255, 0, 0)
    expect(fillRect).toHaveBeenCalledWith(5, 5, 20, 20)

    // 测试 copyRect
    renderer.copyRect(0, 0, 50, 50, 100, 100)
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 50, 50, 100, 100, 50, 50)
  })

  it('createRfbRenderer falls back to Canvas2D when WebGL context is unavailable', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((type: string) => {
        if (type === 'webgl') return null
        if (type === '2d') {
          return {
            fillStyle: '',
            fillRect: vi.fn(),
            drawImage: vi.fn(),
            createImageData: vi.fn(() => ({ data: new Uint8Array(4) })),
            putImageData: vi.fn(),
          }
        }
        return null
      }),
    } as unknown as HTMLCanvasElement

    const renderer = createRfbRenderer(canvas)
    expect(renderer.mode).toBe('canvas2d')
  })

  it('RfbWebGlRenderer batches multiple rect updates and uploads texture in a single flush pass', () => {
    const texSubImage2D = vi.fn()
    const drawArrays = vi.fn()

    const mockGl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      COMPILE_STATUS: 35713,
      LINK_STATUS: 35714,
      ARRAY_BUFFER: 34962,
      STATIC_DRAW: 35044,
      FLOAT: 5126,
      TEXTURE_2D: 3553,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      CLAMP_TO_EDGE: 33071,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      LINEAR: 9729,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      TRIANGLE_STRIP: 5,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      useProgram: vi.fn(),
      createBuffer: vi.fn(() => ({})),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      getAttribLocation: vi.fn(() => 0),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      createTexture: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      viewport: vi.fn(),
      texImage2D: vi.fn(),
      texSubImage2D,
      drawArrays,
      deleteTexture: vi.fn(),
      deleteBuffer: vi.fn(),
      deleteProgram: vi.fn(),
    } as unknown as WebGLRenderingContext

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => mockGl),
    } as unknown as HTMLCanvasElement

    const renderer = new RfbWebGlRenderer(canvas, mockGl)
    expect(renderer.mode).toBe('webgl')

    renderer.init(100, 100)
    texSubImage2D.mockClear()
    drawArrays.mockClear()

    // 绘制 50 个 16x16 的小瓦片（模拟首帧或增量瓦片数据）
    const rawTile = new Uint8Array(16 * 16 * 4).fill(200)
    for (let i = 0; i < 50; i++) {
      renderer.paintRawPixels((i % 5) * 16, Math.floor(i / 5) * 16, 16, 16, rawTile)
      renderer.fillRect((i % 5) * 16, Math.floor(i / 5) * 16, 8, 8, 255, 0, 0)
    }

    // 在 flush 之前，绝对不应该触发昂贵的 GPU texSubImage2D 显存贴图上传
    expect(texSubImage2D).toHaveBeenCalledTimes(0)
    expect(drawArrays).toHaveBeenCalledTimes(0)

    // 统一执行 flush 批量提交
    renderer.flush()

    // 校验：所有 50 个瓦片及子矩形在单次批处理中只触发了一次 texSubImage2D 和一次 drawArrays
    expect(texSubImage2D).toHaveBeenCalledTimes(1)
    expect(drawArrays).toHaveBeenCalledTimes(1)

    renderer.destroy()
  })
})
