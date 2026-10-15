import { describe, it, expect } from 'vitest'
import {
  normalizeKey,
  parseAccelerator,
  matchesShortcut,
  eventToAccelerator,
  acceleratorToDisplayKeys,
  getPressedModifiers,
} from '../shortcut-matcher'

describe('shortcut-matcher', () => {
  it('normalizeKey handles common keys properly', () => {
    expect(normalizeKey('ctrl')).toBe('Ctrl')
    expect(normalizeKey('mod')).toBe('Mod')
    expect(normalizeKey('k')).toBe('K')
    expect(normalizeKey('f11')).toBe('F11')
    expect(normalizeKey('escape')).toBe('Escape')
    expect(normalizeKey('arrowup')).toBe('↑')
  })

  it('parseAccelerator parses Mod properly on Windows and Mac', () => {
    const winParsed = parseAccelerator('Mod+K', false)
    expect(winParsed.ctrl).toBe(true)
    expect(winParsed.meta).toBe(false)
    expect(winParsed.key).toBe('K')

    const macParsed = parseAccelerator('Mod+K', true)
    expect(macParsed.ctrl).toBe(false)
    expect(macParsed.meta).toBe(true)
    expect(macParsed.key).toBe('K')
  })

  it('matchesShortcut matches KeyboardEvent properly', () => {
    // Windows Ctrl+K
    const event1 = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })
    expect(matchesShortcut(event1, 'Ctrl+K')).toBe(true)
    expect(matchesShortcut(event1, 'Ctrl+T')).toBe(false)
    expect(matchesShortcut(event1, 'Ctrl+Shift+K')).toBe(false)

    // F11
    const eventF11 = new KeyboardEvent('keydown', {
      key: 'F11',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    })
    expect(matchesShortcut(eventF11, 'F11')).toBe(true)
    expect(matchesShortcut(eventF11, 'F12')).toBe(false)
  })

  it('eventToAccelerator builds shortcut string', () => {
    // Modifier alone -> null
    const modOnly = new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true })
    expect(eventToAccelerator(modOnly, false)).toBeNull()

    // Ctrl+Shift+C
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(eventToAccelerator(event, false)).toBe('Ctrl+Shift+C')
  })

  it('acceleratorToDisplayKeys formats keys', () => {
    expect(acceleratorToDisplayKeys('Mod+K', false)).toEqual(['Ctrl', 'K'])
    expect(acceleratorToDisplayKeys('Mod+K', true)).toEqual(['⌘', 'K'])
    expect(acceleratorToDisplayKeys('Ctrl+Shift+Tab', false)).toEqual(['Ctrl', 'Shift', 'Tab'])
  })

  it('getPressedModifiers extracts active modifier keys', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Control',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(getPressedModifiers(event, false)).toEqual(['Ctrl', 'Shift'])
    expect(getPressedModifiers(event, true)).toEqual(['⌃', '⇧'])
  })
})

