import { describe, it, expect, vi } from 'vitest'
import { computeSafeTerminalDimensions, fitTerminalSafely } from './terminal'

describe('terminal fit and safe dimensions', () => {
  it('reserves 2 safety columns for standard dimensions', () => {
    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 120, rows: 40 }),
    }
    const dims = computeSafeTerminalDimensions(fakeFitAddon)
    expect(dims).toEqual({ cols: 118, rows: 40 })
  })

  it('handles narrow terminals correctly without dropping below 2 columns', () => {
    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 4, rows: 10 }),
    }
    const dims = computeSafeTerminalDimensions(fakeFitAddon)
    expect(dims).toEqual({ cols: 2, rows: 10 })

    const fakeSmall = {
      proposeDimensions: () => ({ cols: 3, rows: 10 }),
    }
    expect(computeSafeTerminalDimensions(fakeSmall)).toEqual({ cols: 3, rows: 10 })
  })

  it('returns null when terminal is hidden or dimensions are invalid', () => {
    expect(computeSafeTerminalDimensions({ proposeDimensions: () => undefined })).toBeNull()
    expect(computeSafeTerminalDimensions({ proposeDimensions: () => ({ cols: 0, rows: 0 }) })).toBeNull()
    expect(computeSafeTerminalDimensions({ proposeDimensions: () => ({ cols: 1, rows: 20 }) })).toBeNull()
    expect(computeSafeTerminalDimensions({ proposeDimensions: () => ({ cols: 80, rows: 0 }) })).toBeNull()
  })

  it('does not resize if terminal already has safe dimensions (prevents tab switch jitter)', () => {
    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 100, rows: 30 }),
    }
    const fakeTerm = {
      cols: 98,
      rows: 30,
      resize: vi.fn(),
    } as any

    const resized = fitTerminalSafely(fakeFitAddon as any, fakeTerm)
    expect(resized).toBe(false)
    expect(fakeTerm.resize).not.toHaveBeenCalled()
  })

  it('resizes directly to safe dimensions when container size has changed', () => {
    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 120, rows: 35 }),
    }
    const fakeTerm = {
      cols: 98,
      rows: 30,
      resize: vi.fn(),
    } as any

    const resized = fitTerminalSafely(fakeFitAddon as any, fakeTerm)
    expect(resized).toBe(true)
    expect(fakeTerm.resize).toHaveBeenCalledTimes(1)
    expect(fakeTerm.resize).toHaveBeenCalledWith(118, 35)
  })

  it('maximizes row capacity with zero vertical padding without truncation or dropped lines', () => {
    // 容器高度 504px，cell.height 18px（正好是 28 行整数倍）：
    // 可用高度 = 504px: 504 / 18 = 28 行整！
    // 满容纳 28 行，底端不裁切，且绝不因为额外扣除微像素而少算一行
    const fakeParent = {
      getBoundingClientRect: () => ({ width: 800, height: 504 }),
    }
    const fakeStyle = {
      paddingTop: '0px',
      paddingBottom: '0px',
      paddingLeft: '4px',
      paddingRight: '4px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
    }
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(fakeStyle as any)

    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 80, rows: 28 }),
      _terminal: {
        element: {
          parentElement: fakeParent,
        },
        options: {
          scrollback: 1000,
          overviewRuler: { width: 4 },
        },
        _core: {
          _renderService: {
            dimensions: {
              css: {
                cell: {
                  width: 9,
                  height: 18,
                },
              },
            },
          },
        },
      },
    }

    const dims = computeSafeTerminalDimensions(fakeFitAddon as any)
    expect(dims).not.toBeNull()
    // 能够完整容纳 28 行，且不会空出一整行巨大留白
    expect(dims!.rows).toBe(28)

    vi.restoreAllMocks()
  })

  it('balances remainder to keep bottom prompt close to status bar (<= 3px) without empty row gaps', () => {
    const fakeParent = {
      getBoundingClientRect: () => ({ width: 800, height: 506 }),
      style: {} as Record<string, string>,
    }
    const fakeStyle = {
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
    }
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(fakeStyle as any)

    const fakeFitAddon = {
      proposeDimensions: () => ({ cols: 80, rows: 28 }),
      _terminal: {
        element: {
          parentElement: fakeParent,
        },
        options: {
          scrollback: 1000,
          overviewRuler: { width: 4 },
        },
        _core: {
          _renderService: {
            dimensions: {
              css: {
                cell: {
                  width: 9,
                  height: 18,
                },
              },
            },
          },
        },
      },
    }

    const dims = computeSafeTerminalDimensions(fakeFitAddon as any)
    expect(dims).not.toBeNull()
    expect(dims!.rows).toBe(28)
    // 506 - 28 * 18 = 2px 余数，被安全保留在底部（<= 3px），不往上挤出大空隙
    expect(fakeParent.style.paddingBottom).toBe('2px')
    expect(fakeParent.style.paddingTop).toBe('0px')

    vi.restoreAllMocks()
  })
})

