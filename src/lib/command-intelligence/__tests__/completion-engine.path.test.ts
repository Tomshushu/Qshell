import { describe, it, expect } from 'vitest'
import { matchHints } from '../completion-engine'

/**
 * 路径补全阶段判定回归测试。
 *
 * 背景：`shouldTriggerPathCompletion` 曾漏判 `dir` 类型，导致 `cd <相对路径>`
 * 永远不触发路径补全（只有绝对路径靠 isPathLikeToken 兜底才正常）。
 */
describe('路径补全阶段判定', () => {
  it('cd + 相对路径 → path 阶段，过滤目录', () => {
    const r = matchHints('cd im')
    expect(r.phase).toBe('path')
    expect(r.expectingPath).toBe(true)
    expect(r.pathFilterMode).toBe('dir')
  })

  it('cd + 空 token → 同样触发 path（刚敲完空格）', () => {
    const r = matchHints('cd ')
    expect(r.phase).toBe('path')
    expect(r.expectingPath).toBe(true)
    expect(r.pathFilterMode).toBe('dir')
  })

  it('cat + 相对路径 → path 阶段，过滤文件', () => {
    const r = matchHints('cat im')
    expect(r.phase).toBe('path')
    expect(r.expectingPath).toBe(true)
    expect(r.pathFilterMode).toBe('file')
  })

  it('cd + 绝对路径 → path 阶段（不依赖位置参数 type）', () => {
    const r = matchHints('cd /root/im')
    expect(r.phase).toBe('path')
    expect(r.expectingPath).toBe(true)
  })

  it('mkdir + 相对路径 → path 阶段，过滤目录', () => {
    const r = matchHints('mkdir ne')
    expect(r.phase).toBe('path')
    expect(r.pathFilterMode).toBe('dir')
  })
})
