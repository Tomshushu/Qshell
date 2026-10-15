export type ShortcutScope = 'global' | 'terminal' | 'sftp' | 'dashboard'

export interface ShortcutDefinition {
  id: string
  titleKey: string
  descKey: string
  scope: ShortcutScope
  /**
   * 默认按键组合字符串。
   * 支持修饰键：Mod（Win/Linux 为 Ctrl，Mac 为 Cmd）、Ctrl、Alt、Shift、Meta
   * 如：'Mod+K', 'Mod+T', 'Ctrl+Tab', 'Ctrl+Shift+C', 'F11'
   */
  defaultKey: string
  /** Mac 平台的专属默认按键（若与通用不同，如 Mac 下复制通常为 Cmd+C） */
  defaultMacKey?: string
  /** 是否为系统保护快捷键（不可解绑清空） */
  isProtected?: boolean
}

/** 动作注册表清单 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // ── 全局与标签页管理 ──
  {
    id: 'app.commandPalette',
    titleKey: 'shortcut_command_palette',
    descKey: 'shortcut_command_palette_desc',
    scope: 'global',
    defaultKey: 'Mod+K',
    isProtected: true,
  },
  {
    id: 'app.lock',
    titleKey: 'shortcut_app_lock',
    descKey: 'shortcut_app_lock_desc',
    scope: 'global',
    defaultKey: 'Mod+Alt+L',
  },
  {
    id: 'tab.new',
    titleKey: 'shortcut_tab_new',
    descKey: 'shortcut_tab_new_desc',
    scope: 'global',
    defaultKey: 'Mod+T',
  },
  {
    id: 'tab.close',
    titleKey: 'shortcut_tab_close',
    descKey: 'shortcut_tab_close_desc',
    scope: 'global',
    defaultKey: 'Mod+W',
  },
  {
    id: 'tab.next',
    titleKey: 'shortcut_tab_next',
    descKey: 'shortcut_tab_next_desc',
    scope: 'global',
    defaultKey: 'Ctrl+Tab',
  },
  {
    id: 'tab.prev',
    titleKey: 'shortcut_tab_prev',
    descKey: 'shortcut_tab_prev_desc',
    scope: 'global',
    defaultKey: 'Ctrl+Shift+Tab',
  },

  // ── 终端会话操作 ──
  {
    id: 'terminal.search',
    titleKey: 'shortcut_terminal_search',
    descKey: 'shortcut_terminal_search_desc',
    scope: 'terminal',
    defaultKey: 'Mod+F',
  },
  {
    id: 'terminal.copy',
    titleKey: 'shortcut_terminal_copy',
    descKey: 'shortcut_terminal_copy_desc',
    scope: 'terminal',
    defaultKey: 'Ctrl+Shift+C',
    defaultMacKey: 'Cmd+C',
  },
  {
    id: 'terminal.paste',
    titleKey: 'shortcut_terminal_paste',
    descKey: 'shortcut_terminal_paste_desc',
    scope: 'terminal',
    defaultKey: 'Ctrl+Shift+V',
    defaultMacKey: 'Cmd+V',
  },
  {
    id: 'terminal.fullscreen',
    titleKey: 'shortcut_terminal_fullscreen',
    descKey: 'shortcut_terminal_fullscreen_desc',
    scope: 'terminal',
    defaultKey: 'F11',
  },
  {
    id: 'terminal.fontSizeUp',
    titleKey: 'shortcut_terminal_font_up',
    descKey: 'shortcut_terminal_font_up_desc',
    scope: 'terminal',
    defaultKey: 'Mod+=',
  },
  {
    id: 'terminal.fontSizeDown',
    titleKey: 'shortcut_terminal_font_down',
    descKey: 'shortcut_terminal_font_down_desc',
    scope: 'terminal',
    defaultKey: 'Mod+-',
  },
  {
    id: 'terminal.fontSizeReset',
    titleKey: 'shortcut_terminal_font_reset',
    descKey: 'shortcut_terminal_font_reset_desc',
    scope: 'terminal',
    defaultKey: 'Mod+0',
  },

  // ── SFTP 文件管理 ──
  {
    id: 'sftp.refresh',
    titleKey: 'shortcut_sftp_refresh',
    descKey: 'shortcut_sftp_refresh_desc',
    scope: 'sftp',
    defaultKey: 'F5',
  },
  {
    id: 'sftp.rename',
    titleKey: 'shortcut_sftp_rename',
    descKey: 'shortcut_sftp_rename_desc',
    scope: 'sftp',
    defaultKey: 'F2',
  },
  {
    id: 'sftp.delete',
    titleKey: 'shortcut_sftp_delete',
    descKey: 'shortcut_sftp_delete_desc',
    scope: 'sftp',
    defaultKey: 'Delete',
  },

  // ── 仪表盘快捷键 ──
  {
    id: 'dashboard.search',
    titleKey: 'shortcut_dashboard_search',
    descKey: 'shortcut_dashboard_search_desc',
    scope: 'dashboard',
    defaultKey: 'Mod+F',
  },
]
