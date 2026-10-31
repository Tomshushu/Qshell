import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import type { TerminalTheme, TerminalThemeOverride } from '@/utils/terminal-themes'
import type { HighlightRule } from '@/utils/terminal-highlighter'

function state() {
  return useAppStore.getState()
}

describe('terminal-slice', () => {
  beforeEach(() => {
    useAppStore.setState({
      terminalFontSize: 13,
      terminalFontFamily: '"Cascadia Code", monospace',
      terminalThemeId: 'termius-dark',
      customTerminalThemes: [],
      terminalThemeOverrides: {},
      terminalHighlightEnabled: true,
      terminalHighlightRules: [],
      terminalAntiIdleInterval: 60,
      terminalScrollbackLines: 10000,
      terminalWindowSizeKb: 1024,
      terminalRecordingMaxSizeMb: 200,
    })
  })

  describe('font size and family', () => {
    it('sets terminal font size directly', () => {
      state().setTerminalFontSize(16)
      expect(state().terminalFontSize).toBe(16)
    })

    it('sets terminal font size using an updater function', () => {
      state().setTerminalFontSize((prev) => prev + 2)
      expect(state().terminalFontSize).toBe(15)
    })

    it('clamps font size to minimum 9 and maximum 30', () => {
      state().setTerminalFontSize(4)
      expect(state().terminalFontSize).toBe(9)

      state().setTerminalFontSize(50)
      expect(state().terminalFontSize).toBe(30)
    })

    it('updates font family', () => {
      state().setTerminalFontFamily('Fira Code')
      expect(state().terminalFontFamily).toBe('Fira Code')
    })
  })

  describe('numerical boundary clamps', () => {
    it('clamps anti-idle interval between 10 and 3600 seconds', () => {
      state().setTerminalAntiIdleInterval(2)
      expect(state().terminalAntiIdleInterval).toBe(10)

      state().setTerminalAntiIdleInterval(5000)
      expect(state().terminalAntiIdleInterval).toBe(3600)

      state().setTerminalAntiIdleInterval(120.8)
      expect(state().terminalAntiIdleInterval).toBe(120)
    })

    it('clamps scrollback lines between 1000 and 128000 lines', () => {
      state().setTerminalScrollbackLines(500)
      expect(state().terminalScrollbackLines).toBe(1000)

      state().setTerminalScrollbackLines(200000)
      expect(state().terminalScrollbackLines).toBe(128000)
    })

    it('clamps window size between 256 and 16384 KB', () => {
      state().setTerminalWindowSizeKb(64)
      expect(state().terminalWindowSizeKb).toBe(256)

      state().setTerminalWindowSizeKb(32768)
      expect(state().terminalWindowSizeKb).toBe(16384)
    })

    it('clamps recording max size between 50 and 2048 MB', () => {
      state().setTerminalRecordingMaxSizeMb(10)
      expect(state().terminalRecordingMaxSizeMb).toBe(50)

      state().setTerminalRecordingMaxSizeMb(4096)
      expect(state().terminalRecordingMaxSizeMb).toBe(2048)
    })
  })

  describe('custom themes and overrides', () => {
    const customTheme: TerminalTheme = {
      id: 'custom-solarized',
      name: 'Custom Solarized',
      type: 'dark',
      ui: {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#93a1a1',
        cursorForeground: '#002b36',
        selection: '#073642',
        selectionForeground: '#93a1a1',
      },
      ansi: {
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#002b36',
        brightRed: '#cb4b16',
        brightGreen: '#586e75',
        brightYellow: '#657b83',
        brightBlue: '#839496',
        brightMagenta: '#6c71c4',
        brightCyan: '#93a1a1',
        brightWhite: '#fdf6e3',
      },
    }

    it('adds and updates custom themes', () => {
      state().addCustomTerminalTheme(customTheme)
      expect(state().customTerminalThemes).toHaveLength(1)
      expect(state().customTerminalThemes[0].id).toBe('custom-solarized')

      state().updateCustomTerminalTheme('custom-solarized', { name: 'Solarized Dark Pro' })
      expect(state().customTerminalThemes[0].name).toBe('Solarized Dark Pro')
    })

    it('falls back to default preset if currently active theme is deleted', () => {
      state().addCustomTerminalTheme(customTheme)
      state().setTerminalThemeId('custom-solarized')

      state().deleteCustomTerminalTheme('custom-solarized')
      expect(state().customTerminalThemes).toHaveLength(0)
      // Dark theme fallback
      expect(state().terminalThemeId).toBe('termius-dark')
    })

    it('falls back to termius-light if deleted theme was light', () => {
      const lightTheme: TerminalTheme = { ...customTheme, id: 'custom-light', type: 'light' }
      state().addCustomTerminalTheme(lightTheme)
      state().setTerminalThemeId('custom-light')

      state().deleteCustomTerminalTheme('custom-light')
      expect(state().terminalThemeId).toBe('termius-light')
    })

    it('deduplicates conflicting IDs on import by appending -import', () => {
      state().addCustomTerminalTheme(customTheme)
      const imported = state().importCustomTerminalThemes([
        { ...customTheme, name: 'Imported Theme 1' },
      ])
      expect(imported[0].id).toBe('custom-solarized-import')
      expect(state().customTerminalThemes).toHaveLength(2)
    })

    it('manages theme overrides', () => {
      const override1: TerminalThemeOverride = { opacity: 0.8 }
      state().setTerminalThemeOverride('theme-1', override1)
      expect(state().terminalThemeOverrides['theme-1']).toEqual(override1)

      const override2: TerminalThemeOverride = { blur: 5 }
      state().setTerminalThemeOverride('theme-1', override2)
      expect(state().terminalThemeOverrides['theme-1']).toEqual({
        opacity: 0.8,
        blur: 5,
      })

      state().clearTerminalThemeOverride('theme-1')
      expect(state().terminalThemeOverrides['theme-1']).toBeUndefined()
    })
  })

  describe('highlight rules', () => {
    const testRule: HighlightRule = {
      id: 'rule-error',
      name: 'Error Highlighter',
      regex: 'ERROR',
      color: '#ff0000',
      enabled: true,
    }

    it('adds, updates and deletes highlight rules', () => {
      state().addHighlightRule(testRule)
      expect(state().terminalHighlightRules).toHaveLength(1)

      state().updateHighlightRule('rule-error', { color: '#cc0000', enabled: false })
      expect(state().terminalHighlightRules[0].color).toBe('#cc0000')
      expect(state().terminalHighlightRules[0].enabled).toBe(false)

      state().deleteHighlightRule('rule-error')
      expect(state().terminalHighlightRules).toHaveLength(0)
    })
  })
})
