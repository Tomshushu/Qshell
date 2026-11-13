import { describe, it, expect, beforeEach } from 'vitest'
import { useWindowLayerStore, WINDOW_Z_BASE, WINDOW_Z_MAX } from '../window-layer-store'

describe('window-layer-store (窗口层级栈)', () => {
  const s = () => useWindowLayerStore.getState()

  beforeEach(() => {
    useWindowLayerStore.setState({ layers: {}, topZ: WINDOW_Z_BASE - 1 })
  })

  it('新打开的窗口依次置顶', () => {
    s().register('devtools')
    const z1 = s().layers['devtools']
    expect(z1).toBe(WINDOW_Z_BASE)

    s().register('theme')
    expect(s().layers['theme']).toBeGreaterThan(z1)
    expect(s().topZ).toBe(s().layers['theme'])
  })

  it('点击已有窗口可再次置顶，已在顶层时不重复抬升', () => {
    s().register('a')
    s().register('b')
    const zb = s().layers['b']

    s().bringToFront('a')
    expect(s().layers['a']).toBeGreaterThan(zb)

    const za = s().layers['a']
    s().bringToFront('a')
    expect(s().layers['a']).toBe(za)
  })

  it('关闭时注销；区间用尽后紧凑重排并保持相对顺序', () => {
    s().register('a')
    s().register('b')
    s().unregister('a')
    expect(s().layers['a']).toBeUndefined()
    expect(s().layers['b']).toBe(WINDOW_Z_BASE + 1)

    for (let i = 0; i < WINDOW_Z_MAX - WINDOW_Z_BASE + 5; i++) {
      s().bringToFront('c')
      s().bringToFront('b')
    }

    expect(s().topZ).toBeLessThanOrEqual(WINDOW_Z_MAX)
    expect(s().layers['b']).toBeLessThanOrEqual(WINDOW_Z_MAX)
    expect(s().layers['c']).toBeLessThan(s().layers['b'])
  })
})
