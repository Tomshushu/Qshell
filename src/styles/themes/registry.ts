/**
 * 界面设计语言 / UI 风格注册中心
 * 风格引擎完全基于 CSS 令牌驱动，与业务逻辑彻底解耦。
 * 后续扩展新风格（如喵~、赛博朋克等）仅需在此添加元数据并在 CSS 中定义对应选择器，业务代码 0 修改。
 */

export type UiStyleId = 'apple' | 'ubuntu' | string

export interface UiStyleConfig {
  id: UiStyleId
  nameKey: string
  shortNameKey: string
  accentColor: string
  previewColors: string[]
}

export const UI_STYLES: UiStyleConfig[] = [
  {
    id: 'ubuntu',
    nameKey: 'ui_style_ubuntu',
    shortNameKey: 'ui_style_ubuntu_short',
    accentColor: '#E95420',
    previewColors: ['#E95420', '#77216F', '#AEA79F'],
  },
  {
    id: 'apple',
    nameKey: 'ui_style_apple',
    shortNameKey: 'ui_style_apple_short',
    accentColor: '#007AFF',
    previewColors: ['#007AFF', '#5856D6', '#E5E5EA'],
  },
  {
    id: 'cyberpunk',
    nameKey: 'ui_style_cyberpunk',
    shortNameKey: 'ui_style_cyberpunk_short',
    accentColor: '#00F0FF',
    previewColors: ['#00F0FF', '#FF2E88', '#0D0221'],
  },
  {
    id: 'anime',
    nameKey: 'ui_style_anime',
    shortNameKey: 'ui_style_anime_short',
    accentColor: '#FF7BA9',
    previewColors: ['#FF7BA9', '#56CCF2', '#C084FC'],
  },
  {
    id: 'nord',
    nameKey: 'ui_style_nord',
    shortNameKey: 'ui_style_nord_short',
    accentColor: '#3F726D',
    previewColors: ['#3F726D', '#7FBFB8', '#F4F5F2'],
  },
  {
    id: 'retro-crt',
    nameKey: 'ui_style_retro_crt',
    shortNameKey: 'ui_style_retro_crt_short',
    accentColor: '#33FF33',
    previewColors: ['#33FF33', '#1B3D1B', '#0A0E0A'],
  },
  {
    id: 'win98',
    nameKey: 'ui_style_win98',
    shortNameKey: 'ui_style_win98_short',
    accentColor: '#000080',
    previewColors: ['#000080', '#008080', '#C0C0C0'],
  },
  {
    id: 'mecha',
    nameKey: 'ui_style_mecha',
    shortNameKey: 'ui_style_mecha_short',
    accentColor: '#FFCC00',
    previewColors: ['#FFCC00', '#FF3B30', '#1E2328'],
  },
  {
    id: 'ink',
    nameKey: 'ui_style_ink',
    shortNameKey: 'ui_style_ink_short',
    accentColor: '#181A1D',
    previewColors: ['#181A1D', '#8C97A4', '#F4F1E8'],
  },
]

export function getUiStyleConfig(id: string): UiStyleConfig {
  return UI_STYLES.find((s) => s.id === id) || UI_STYLES[0]
}
