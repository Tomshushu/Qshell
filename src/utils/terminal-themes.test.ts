import { describe, expect, it } from 'vitest'
import { PRESET_TERMINAL_THEMES, resolveTerminalSelectionColors, themeToXtermTheme } from './terminal-themes'

describe('preset terminal theme accessibility', () => {
  it('keeps every preset selection visible and its text readable', () => {
    for (const theme of PRESET_TERMINAL_THEMES) {
      const colors = resolveTerminalSelectionColors(theme)
      expect(colors.areaContrast, `${theme.id} selection area`).toBeGreaterThanOrEqual(1.45)
      expect(colors.textContrast, `${theme.id} selection text`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('uses the resolved colors for active and inactive xterm selections', () => {
    for (const theme of PRESET_TERMINAL_THEMES) {
      const colors = resolveTerminalSelectionColors(theme)
      const xterm = themeToXtermTheme(theme)
      expect(xterm.selectionBackground).toBe(colors.background)
      expect(xterm.selectionInactiveBackground).toBe(colors.background)
      expect(xterm.selectionForeground).toBe(colors.foreground)
    }
  })

  it('prefers a visibly different selection foreground when contrast permits it', () => {
    const theme = PRESET_TERMINAL_THEMES.find(item => item.id === 'solarized-light')
      || PRESET_TERMINAL_THEMES.find(item => item.type === 'light')
    expect(theme).toBeDefined()
    if (!theme) return

    const colors = resolveTerminalSelectionColors(theme)
    expect(colors.foreground.toLowerCase()).not.toBe(theme.ui.foreground.toLowerCase())
    expect(colors.textContrast).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps custom theme selection colors exactly consistent with the editor', () => {
    const base = PRESET_TERMINAL_THEMES[0]
    const customTheme = {
      ...base,
      id: 'custom-selection-colors',
      ui: {
        ...base.ui,
        selection: '#aab6cb',
        selectionForeground: '#cc1e64',
      },
    }

    const colors = resolveTerminalSelectionColors(customTheme)
    const xterm = themeToXtermTheme(customTheme)
    expect(colors.background).toBe('#aab6cb')
    expect(colors.foreground).toBe('#cc1e64')
    expect(xterm.selectionBackground).toBe('#aab6cb')
    expect(xterm.selectionForeground).toBe('#cc1e64')
  })

  it('includes exclusive kawaii dark and light terminal themes with proper properties', () => {
    const dark = PRESET_TERMINAL_THEMES.find((t) => t.id === 'kawaii-dark')
    const light = PRESET_TERMINAL_THEMES.find((t) => t.id === 'kawaii-light')

    expect(dark).toBeDefined()
    expect(dark?.type).toBe('dark')
    expect(dark?.name).toContain('喵~')
    expect(dark?.ui.cursor).toBe('#ff7ba9')

    expect(light).toBeDefined()
    expect(light?.type).toBe('light')
    expect(light?.name).toContain('喵~')
    expect(light?.ui.background).toBe('#faf4ee')
  })
})

describe('ui style and terminal theme independence', () => {
  it('does not alter terminal theme when switching UI styles', async () => {
    const { useAppStore } = await import('@/store')
    useAppStore.setState({
      uiStyle: 'apple',
      theme: 'dark',
      terminalThemeId: 'termius-dark',
    })

    useAppStore.getState().setUiStyle('anime')
    expect(useAppStore.getState().uiStyle).toBe('anime')
    expect(useAppStore.getState().terminalThemeId).toBe('termius-dark')

    useAppStore.getState().setUiStyle('ubuntu')
    expect(useAppStore.getState().uiStyle).toBe('ubuntu')
    expect(useAppStore.getState().terminalThemeId).toBe('termius-dark')
  }, 15000)

  it('allows user to manually select kawaii themes when desired', async () => {
    const { useAppStore } = await import('@/store')
    useAppStore.getState().setTerminalThemeId('kawaii-dark')
    expect(useAppStore.getState().terminalThemeId).toBe('kawaii-dark')

    useAppStore.getState().setTerminalThemeId('kawaii-light')
    expect(useAppStore.getState().terminalThemeId).toBe('kawaii-light')
  }, 15000)
})



