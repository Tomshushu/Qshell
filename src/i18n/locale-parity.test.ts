import { describe, expect, it } from 'vitest'
import zhCN from './locales/zh-CN'
import en from './locales/en'

describe('primary locale parity', () => {
  it('keeps Chinese and English translation keys aligned', () => {
    const zhKeys = Object.keys(zhCN).sort()
    const enKeys = Object.keys(en).sort()
    expect(zhKeys.filter((key) => !(key in en))).toEqual([])
    expect(enKeys.filter((key) => !(key in zhCN))).toEqual([])
  })

  it('does not leave empty primary translations', () => {
    expect(Object.entries(zhCN).filter(([, value]) => !String(value).trim())).toEqual([])
    expect(Object.entries(en).filter(([, value]) => !String(value).trim())).toEqual([])
  })
})
