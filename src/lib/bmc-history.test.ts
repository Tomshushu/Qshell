import { describe, it, expect, beforeEach } from 'vitest'
import {
  appendBmcSamples,
  getBmcHistory,
  clearBmcHistory,
} from './bmc-history'

describe('bmc-history', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('appends samples and retrieves history', () => {
    appendBmcSamples('bmc-1', [
      { key: 'temp:CPU', value: 45.5 },
      { key: 'fan:System', value: 1200 },
    ])

    const history = getBmcHistory('bmc-1')
    expect(history['temp:CPU']).toHaveLength(1)
    expect(history['temp:CPU'][0][1]).toBe(45.5)
    expect(history['fan:System']).toHaveLength(1)
    expect(history['fan:System'][0][1]).toBe(1200)
  })

  it('filters out non-finite numbers like NaN or Infinity', () => {
    appendBmcSamples('bmc-1', [
      { key: 'temp:Invalid', value: NaN },
      { key: 'temp:Inf', value: Infinity },
      { key: 'temp:Valid', value: 50 },
    ])

    const history = getBmcHistory('bmc-1')
    expect(history['temp:Invalid']).toBeUndefined()
    expect(history['temp:Inf']).toBeUndefined()
    expect(history['temp:Valid']).toHaveLength(1)
  })

  it('caps samples per sensor at MAX_POINTS (864)', () => {
    for (let i = 0; i < 900; i++) {
      appendBmcSamples('bmc-1', [{ key: 'temp:CPU', value: i }])
    }

    const history = getBmcHistory('bmc-1')
    expect(history['temp:CPU']).toHaveLength(864)
    // Oldest were pruned, latest is 899
    expect(history['temp:CPU'][863][1]).toBe(899)
  })

  it('clears BMC history for a specific server', () => {
    appendBmcSamples('bmc-1', [{ key: 'temp:CPU', value: 40 }])
    appendBmcSamples('bmc-2', [{ key: 'temp:CPU', value: 50 }])

    clearBmcHistory('bmc-1')
    expect(getBmcHistory('bmc-1')).toEqual({})
    expect(getBmcHistory('bmc-2')['temp:CPU']).toHaveLength(1)
  })

  it('handles empty server ID and empty samples gracefully', () => {
    appendBmcSamples('', [{ key: 'temp:CPU', value: 40 }])
    appendBmcSamples('bmc-1', [])
    expect(getBmcHistory('bmc-1')).toEqual({})
  })
})
