import type { FileIconTheme, FileIconThemeId } from './types'
import { precisionTheme } from './themes/precision'
import { yaruTheme } from './themes/yaru'
import { developerTheme } from './themes/developer'
import { minimalTheme } from './themes/minimal'

export const FILE_ICON_THEMES: Record<FileIconThemeId, FileIconTheme> = {
  developer: developerTheme,
  precision: precisionTheme,
  yaru: yaruTheme,
  minimal: minimalTheme,
}

export const DEFAULT_FILE_ICON_THEME: FileIconThemeId = 'developer'

export function getFileIconTheme(id?: string | null): FileIconTheme {
  if (id && id in FILE_ICON_THEMES) {
    return FILE_ICON_THEMES[id as FileIconThemeId]
  }
  return FILE_ICON_THEMES[DEFAULT_FILE_ICON_THEME]
}

export function getAllFileIconThemes(): FileIconTheme[] {
  return Object.values(FILE_ICON_THEMES)
}
