import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseAliasOutput,
  setUserAliases,
  matchAliases,
  isKnownAlias,
  isUserAliasesLoaded,
  clearUserAliases,
  COMMON_ALIASES,
} from '../alias-map'

describe('parseAliasOutput', () => {
  it('解析单引号 / 双引号 / 无引号形式', () => {
    const out = [
      "alias ll='ls -alF'",
      'alias gs="git status"',
      'alias k=kubectl',
      '  alias dk=docker  # 行尾注释',
    ].join('\n')

    expect(parseAliasOutput(out)).toEqual([
      { name: 'll', expandsTo: 'ls -alF' },
      { name: 'gs', expandsTo: 'git status' },
      { name: 'k', expandsTo: 'kubectl' },
      { name: 'dk', expandsTo: 'docker' },
    ])
  })

  it('忽略非 alias 行与注释行', () => {
    const out = ['# alias fake=x', 'export FOO=bar', 'PATH=/usr/bin'].join('\n')
    expect(parseAliasOutput(out)).toEqual([])
  })

  it('同名别名只保留第一条', () => {
    const out = ["alias a='one'", "alias a='two'"].join('\n')
    expect(parseAliasOutput(out)).toEqual([{ name: 'a', expandsTo: 'one' }])
  })
})

describe('用户别名合并', () => {
  beforeEach(() => {
    clearUserAliases()
  })

  it('未加载时只返回内置别名', () => {
    expect(isUserAliasesLoaded('srv-1')).toBe(false)
    const r = matchAliases('l', 10)
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((a) => COMMON_ALIASES[a.name] !== undefined)).toBe(true)
  })

  it('注册后参与匹配，且覆盖同名内置别名', () => {
    setUserAliases('srv-1', [
      { name: 'k', expandsTo: 'kubectl' },
      { name: 'll', expandsTo: 'ls -lh --color' },
    ])
    expect(isUserAliasesLoaded('srv-1')).toBe(true)

    const r = matchAliases('k', 10, 'srv-1')
    expect(r.some((a) => a.name === 'k' && a.expandsTo === 'kubectl')).toBe(true)

    const ll = matchAliases('ll', 10, 'srv-1').find((a) => a.name === 'll')
    expect(ll?.expandsTo).toBe('ls -lh --color')
  })

  it('isKnownAlias 识别用户别名（按服务器隔离）', () => {
    setUserAliases('srv-2', [{ name: 'gs', expandsTo: 'git status' }])
    expect(isKnownAlias('gs', 'srv-2')).toBe(true)
    expect(isKnownAlias('gs', 'other-server')).toBe(false)
  })

  it('clearUserAliases 清空指定服务器', () => {
    setUserAliases('srv-3', [{ name: 'x', expandsTo: 'y' }])
    clearUserAliases('srv-3')
    expect(isUserAliasesLoaded('srv-3')).toBe(false)
    expect(isKnownAlias('x', 'srv-3')).toBe(false)
  })
})
