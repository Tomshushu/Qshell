export interface TerminalTheme {
  id: string
  name: string
  type: 'dark' | 'light'
  ui: {
    background: string
    foreground: string
    cursor: string
    /** 光标所在字符的前景色（xterm ITheme.cursorForeground）。
     *  iTerm2/Windows Terminal/Termius 均支持，避免亮色光标 + 亮色背景时光标下字符看不清。
     *  常见做法：设为背景色，让光标下字符"反色"显示。 */
    cursorForeground: string
    selection: string
    /** 选中文本的前景色（xterm ITheme.selectionForeground）。
     *  Windows Terminal 支持。不设置时 xterm 自动用 foreground，
     *  显式设置可在 selection 背景色与 foreground 接近时保证可读性。 */
    selectionForeground: string
    activeBorder?: string
  }
  /** 自定义终端背景配置（可选）。仅自定义主题使用，预设主题不配置。
   *  实现方式：容器元素铺背景媒体，xterm theme.background 降为半透明 rgba，
   *  让背景从 canvas 下方透出。 */
  background?: {
    /** 背景媒体类型：image=静态/动态图片(base64)，video=视频文件(路径)。
     *  不设置时按 image/video 字段是否存在自动推断（向后兼容）。 */
    type?: 'image' | 'video'
    /** 图片 base64 data URL（支持 png/jpeg/webp/gif）。type=image 时使用。 */
    image?: string
    /** 视频文件路径（type=video 时使用，指向 appDataDir/backgrounds/ 下的文件）。
     *  渲染时通过 convertFileSrc 转为 asset:// URL 加载，不读入内存。 */
    videoPath?: string
    /** 背景色不透明度 0-1（控制背景媒体透出程度）。1=纯色背景不透出，0=完全透出背景。
     *  实际作用于 xterm canvas 的 background alpha。默认 1。 */
    opacity?: number
    /** 背景高斯模糊半径 px。0=不模糊。默认 0。 */
    blur?: number
    /** 背景尺寸模式：cover 铺满 / contain 完整显示 / center 原始尺寸居中。默认 cover。 */
    size?: 'cover' | 'contain' | 'center'
  }
  ansi: {
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
}

export const PRESET_TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'termius-dark',
    name: 'Termius Dark',
    type: 'dark',
    ui: {
      background: '#181824',
      foreground: '#b2b2b2',
      cursor: '#00ff88',
      cursorForeground: '#181824',
      selection: 'rgba(185, 195, 230, 0.45)',
      selectionForeground: '#ffffff',
      activeBorder: '#38bdf8',
    },
    ansi: {
      black: '#000000',
      red: '#f14c4c',
      green: '#23d18b',
      yellow: '#f5f543',
      blue: '#3b8eea',
      magenta: '#d670d6',
      cyan: '#29b8db',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'termius-light',
    name: 'Termius Light',
    type: 'light',
    ui: {
      background: '#f4f4f6',
      foreground: '#181824',
      cursor: '#181824',
      cursorForeground: '#f4f4f6',
      selection: 'rgba(56, 139, 253, 0.28)',
      selectionForeground: '#181824',
      activeBorder: '#0284c7',
    },
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#00bc74',
      yellow: '#b5ba00',
      blue: '#0451a5',
      magenta: '#bc05bc',
      cyan: '#00b6da',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#cd3131',
      brightGreen: '#00bc74',
      brightYellow: '#b5ba00',
      brightBlue: '#0451a5',
      brightMagenta: '#bc05bc',
      brightCyan: '#00b6da',
      brightWhite: '#a5a5a5',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    type: 'dark',
    ui: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      cursorForeground: '#1a1b26',
      selection: 'rgba(81, 92, 126, 0.4)',
      selectionForeground: '#c0caf5',
      activeBorder: '#7aa2f7',
    },
    ansi: {
      black: '#414868',
      red: '#f7768e',
      green: '#73daca',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#c0caf5',
      brightBlack: '#565f89',
      brightRed: '#f7768e',
      brightGreen: '#73daca',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#a9b1d6',
    },
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    type: 'dark',
    ui: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorForeground: '#1e1e2e',
      selection: 'rgba(88, 91, 112, 0.4)',
      selectionForeground: '#cdd6f4',
      activeBorder: '#89b4fa',
    },
    ansi: {
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#cba6f7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#cba6f7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8',
    },
  },
  {
    id: 'flexoki-dark',
    name: 'Flexoki Dark',
    type: 'dark',
    ui: {
      background: '#100f0f',
      foreground: '#cecdc3',
      cursor: '#cecdc3',
      cursorForeground: '#100f0f',
      selection: 'rgba(206, 205, 195, 0.15)',
      selectionForeground: '#cecdc3',
      activeBorder: '#3aa99f',
    },
    ansi: {
      black: '#100f0f',
      red: '#af3029',
      green: '#66800b',
      yellow: '#ad8300',
      blue: '#205ea6',
      magenta: '#5e4085',
      cyan: '#24837b',
      white: '#cecdc3',
      brightBlack: '#575653',
      brightRed: '#d14d41',
      brightGreen: '#879a39',
      brightYellow: '#d0a215',
      brightBlue: '#4385be',
      brightMagenta: '#8b7c9f',
      brightCyan: '#3aa99f',
      brightWhite: '#fffcf0',
    },
  },
  {
    id: 'flexoki-light',
    name: 'Flexoki Light',
    type: 'light',
    ui: {
      background: '#fffcf0',
      foreground: '#100f0f',
      cursor: '#100f0f',
      cursorForeground: '#fffcf0',
      selection: 'rgba(16, 15, 15, 0.15)',
      selectionForeground: '#100f0f',
      activeBorder: '#24837b',
    },
    ansi: {
      black: '#fffcf0',
      red: '#d14d41',
      green: '#879a39',
      yellow: '#d0a215',
      blue: '#4385be',
      magenta: '#8b7c9f',
      cyan: '#3aa99f',
      white: '#100f0f',
      brightBlack: '#878580',
      brightRed: '#af3029',
      brightGreen: '#66800b',
      brightYellow: '#ad8300',
      brightBlue: '#205ea6',
      brightMagenta: '#5e4085',
      brightCyan: '#24837b',
      brightWhite: '#cecdc3',
    },
  },
  {
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    type: 'dark',
    ui: {
      background: '#1f1f28',
      foreground: '#dcd7ba',
      cursor: '#c8c093',
      cursorForeground: '#1f1f28',
      selection: 'rgba(200, 192, 147, 0.2)',
      selectionForeground: '#dcd7ba',
      activeBorder: '#7e9cd8',
    },
    ansi: {
      black: '#090618',
      red: '#c3404b',
      green: '#76946a',
      yellow: '#c0a36e',
      blue: '#7e9cd8',
      magenta: '#957fb8',
      cyan: '#6a9589',
      white: '#c8c093',
      brightBlack: '#727169',
      brightRed: '#e82424',
      brightGreen: '#98bb6c',
      brightYellow: '#e6c384',
      brightBlue: '#7fb4ca',
      brightMagenta: '#938aa9',
      brightCyan: '#7aa89f',
      brightWhite: '#dcd7ba',
    },
  },
  {
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    type: 'dark',
    ui: {
      background: '#12120f',
      foreground: '#c5c9c5',
      cursor: '#c8c093',
      cursorForeground: '#12120f',
      selection: 'rgba(200, 192, 147, 0.15)',
      selectionForeground: '#c5c9c5',
      activeBorder: '#8ba4b1',
    },
    ansi: {
      black: '#0d0c0c',
      red: '#c4746e',
      green: '#8a9a7b',
      yellow: '#c4b28a',
      blue: '#8ba4b1',
      magenta: '#a292a3',
      cyan: '#8ea4a2',
      white: '#c5c9c5',
      brightBlack: '#a6a69c',
      brightRed: '#e46876',
      brightGreen: '#87a987',
      brightYellow: '#e6c384',
      brightBlue: '#7fb4ca',
      brightMagenta: '#938aa9',
      brightCyan: '#7aa89f',
      brightWhite: '#c8c093',
    },
  },
  {
    id: 'kanagawa-lotus',
    name: 'Kanagawa Lotus',
    type: 'light',
    ui: {
      background: '#eedfbe',
      foreground: '#545464',
      cursor: '#545464',
      cursorForeground: '#eedfbe',
      selection: 'rgba(84, 84, 100, 0.15)',
      selectionForeground: '#545464',
      activeBorder: '#5076ab',
    },
    ansi: {
      black: '#f2ecbc',
      red: '#c84053',
      green: '#6e8557',
      yellow: '#8f7e5b',
      blue: '#5076ab',
      magenta: '#746093',
      cyan: '#4e7e7a',
      white: '#545464',
      brightBlack: '#8a8a92',
      brightRed: '#d7474b',
      brightGreen: '#7e9960',
      brightYellow: '#a99468',
      brightBlue: '#597da9',
      brightMagenta: '#7d6999',
      brightCyan: '#558b85',
      brightWhite: '#43434c',
    },
  },
  // ─────────────────────────────────────────────────────────────
  // 经典高人气主题（与 iTerm2/Termius 标配对齐）
  // ─────────────────────────────────────────────────────────────

  // Dracula —— 几乎所有终端标配的紫色暗色主题
  {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    ui: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorForeground: '#282a36',
      selection: 'rgba(68, 71, 90, 0.5)',
      selectionForeground: '#f8f8f2',
      activeBorder: '#bd93f9',
    },
    ansi: {
      black: '#000000',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e67',
      brightGreen: '#5af78e',
      brightYellow: '#f4f99d',
      brightBlue: '#caa9fa',
      brightMagenta: '#ff92d0',
      brightCyan: '#9aedfe',
      brightWhite: '#ffffff',
    },
  },

  // Nord —— Arctic 北欧冷色调，极简流行
  {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    ui: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      cursorForeground: '#2e3440',
      selection: 'rgba(136, 192, 208, 0.3)',
      selectionForeground: '#d8dee9',
      activeBorder: '#88c0d0',
    },
    ansi: {
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4',
    },
  },

  // One Dark —— Atom 经典主题，程序员最熟悉的配色之一
  {
    id: 'one-dark',
    name: 'One Dark',
    type: 'dark',
    ui: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#abb2bf',
      cursorForeground: '#282c34',
      selection: 'rgba(61, 66, 77, 0.6)',
      selectionForeground: '#abb2bf',
      activeBorder: '#61afef',
    },
    ansi: {
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },

  // Solarized Dark —— Ethan Schoonover 设计的科学化配色经典
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    type: 'dark',
    ui: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorForeground: '#002b36',
      selection: 'rgba(147, 161, 161, 0.3)',
      selectionForeground: '#fdf6e3',
      activeBorder: '#268bd2',
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
  },

  // Solarized Light —— Solarized 浅色配套
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    type: 'light',
    ui: {
      background: '#fdf6e3',
      foreground: '#586e75',
      cursor: '#586e75',
      cursorForeground: '#fdf6e3',
      selection: 'rgba(181, 137, 0, 0.25)',
      selectionForeground: '#073642',
      activeBorder: '#268bd2',
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
  },

  // Gruvbox Dark —— 暖色复古，程序员深爱
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    type: 'dark',
    ui: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorForeground: '#282828',
      selection: 'rgba(146, 131, 116, 0.3)',
      selectionForeground: '#ebdbb2',
      activeBorder: '#fe8019',
    },
    ansi: {
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2',
    },
  },

  // Gruvbox Light —— Gruvbox 浅色配套
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    type: 'light',
    ui: {
      background: '#fbf1c7',
      foreground: '#3c3836',
      cursor: '#3c3836',
      cursorForeground: '#fbf1c7',
      selection: 'rgba(60, 56, 54, 0.2)',
      selectionForeground: '#3c3836',
      activeBorder: '#d65d0e',
    },
    ansi: {
      black: '#fbf1c7',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#7c6f64',
      brightBlack: '#928374',
      brightRed: '#9d0006',
      brightGreen: '#79740e',
      brightYellow: '#b57614',
      brightBlue: '#076678',
      brightMagenta: '#8f3f71',
      brightCyan: '#427b58',
      brightWhite: '#3c3836',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Catppuccin 家族补齐（Latte/Frappe/Macchiato，已有 Mocha）
  // ─────────────────────────────────────────────────────────────

  // Catppuccin Latte —— Catppuccin 浅色变体
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    type: 'light',
    ui: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#dc8a78',
      cursorForeground: '#eff1f5',
      selection: 'rgba(140, 143, 161, 0.3)',
      selectionForeground: '#4c4f69',
      activeBorder: '#1e66f5',
    },
    ansi: {
      black: '#5c5f77',
      red: '#d20f39',
      green: '#40a02b',
      yellow: '#df8e1d',
      blue: '#1e66f5',
      magenta: '#ea76cb',
      cyan: '#179299',
      white: '#acb0be',
      brightBlack: '#6c6f85',
      brightRed: '#d20f39',
      brightGreen: '#40a02b',
      brightYellow: '#df8e1d',
      brightBlue: '#1e66f5',
      brightMagenta: '#ea76cb',
      brightCyan: '#179299',
      brightWhite: '#bcc0cc',
    },
  },

  // Catppuccin Frappe —— Catppuccin 中等深度暗色
  {
    id: 'catppuccin-frappe',
    name: 'Catppuccin Frappe',
    type: 'dark',
    ui: {
      background: '#303446',
      foreground: '#c6d0f5',
      cursor: '#f2d5cf',
      cursorForeground: '#303446',
      selection: 'rgba(99, 104, 127, 0.4)',
      selectionForeground: '#c6d0f5',
      activeBorder: '#8caaee',
    },
    ansi: {
      black: '#51576d',
      red: '#e78284',
      green: '#a6d189',
      yellow: '#e5c890',
      blue: '#8caaee',
      magenta: '#f4b8e4',
      cyan: '#81c8be',
      white: '#b5bfe2',
      brightBlack: '#626880',
      brightRed: '#e78284',
      brightGreen: '#a6d189',
      brightYellow: '#e5c890',
      brightBlue: '#8caaee',
      brightMagenta: '#f4b8e4',
      brightCyan: '#81c8be',
      brightWhite: '#a5adce',
    },
  },

  // Catppuccin Macchiato —— Catppuccin 更深一档暗色
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    type: 'dark',
    ui: {
      background: '#24273a',
      foreground: '#cad3f5',
      cursor: '#f4dbd6',
      cursorForeground: '#24273a',
      selection: 'rgba(86, 89, 112, 0.4)',
      selectionForeground: '#cad3f5',
      activeBorder: '#8aadf4',
    },
    ansi: {
      black: '#494d64',
      red: '#ed8796',
      green: '#a6da95',
      yellow: '#eed49f',
      blue: '#8aadf4',
      magenta: '#f5bde6',
      cyan: '#8bd5ca',
      white: '#b8c0e0',
      brightBlack: '#5b6078',
      brightRed: '#ed8796',
      brightGreen: '#a6da95',
      brightYellow: '#eed49f',
      brightBlue: '#8aadf4',
      brightMagenta: '#f5bde6',
      brightCyan: '#8bd5ca',
      brightWhite: '#a5adcb',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // Tokyo Night 家族补齐（Storm/Light，已有 Night）
  // ─────────────────────────────────────────────────────────────

  // Tokyo Night Storm —— Tokyo Night 更深更蓝的变体
  {
    id: 'tokyo-night-storm',
    name: 'Tokyo Night Storm',
    type: 'dark',
    ui: {
      background: '#24283b',
      foreground: '#a9b1d6',
      cursor: '#c0caf5',
      cursorForeground: '#24283b',
      selection: 'rgba(65, 72, 104, 0.4)',
      selectionForeground: '#c0caf5',
      activeBorder: '#7aa2f7',
    },
    ansi: {
      black: '#1d202f',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5',
    },
  },

  // Tokyo Night Light —— Tokyo Night 浅色配套
  {
    id: 'tokyo-night-light',
    name: 'Tokyo Night Light',
    type: 'light',
    ui: {
      background: '#d5d6db',
      foreground: '#343b58',
      cursor: '#343b58',
      cursorForeground: '#d5d6db',
      selection: 'rgba(150, 153, 179, 0.3)',
      selectionForeground: '#343b58',
      activeBorder: '#34548a',
    },
    ansi: {
      black: '#0f0f14',
      red: '#8c4351',
      green: '#485e30',
      yellow: '#8f5e15',
      blue: '#34548a',
      magenta: '#5a4a78',
      cyan: '#0f4b6e',
      white: '#343b58',
      brightBlack: '#9699a3',
      brightRed: '#8c4351',
      brightGreen: '#485e30',
      brightYellow: '#8f5e15',
      brightBlue: '#34548a',
      brightMagenta: '#5a4a78',
      brightCyan: '#0f4b6e',
      brightWhite: '#343b58',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // 其他经典主题
  // ─────────────────────────────────────────────────────────────

  // Monokai Pro —— Sublime Text 经典主题
  {
    id: 'monokai-pro',
    name: 'Monokai Pro',
    type: 'dark',
    ui: {
      background: '#2d2a2e',
      foreground: '#d4d4d4',
      cursor: '#fcfcfa',
      cursorForeground: '#2d2a2e',
      selection: 'rgba(73, 73, 73, 0.5)',
      selectionForeground: '#fcfcfa',
      activeBorder: '#a6e22e',
    },
    ansi: {
      black: '#2d2a2e',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#fd971f',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#727072',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#fd971f',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#fcfcfa',
    },
  },

  // Material Darker —— Material 主题家族，深色变体
  {
    id: 'material-darker',
    name: 'Material Darker',
    type: 'dark',
    ui: {
      background: '#212121',
      foreground: '#eeffff',
      cursor: '#ffcc00',
      cursorForeground: '#212121',
      selection: 'rgba(85, 139, 255, 0.3)',
      selectionForeground: '#eeffff',
      activeBorder: '#82aaff',
    },
    ansi: {
      black: '#000000',
      red: '#ff5370',
      green: '#c3e88d',
      yellow: '#ffcb6b',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#89ddff',
      white: '#ffffff',
      brightBlack: '#545454',
      brightRed: '#ff5370',
      brightGreen: '#c3e88d',
      brightYellow: '#ffcb6b',
      brightBlue: '#82aaff',
      brightMagenta: '#c792ea',
      brightCyan: '#89ddff',
      brightWhite: '#ffffff',
    },
  },

  // GitHub Dark —— 仿 GitHub 暗色界面
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    type: 'dark',
    ui: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#c9d1d9',
      cursorForeground: '#0d1117',
      selection: 'rgba(56, 139, 253, 0.3)',
      selectionForeground: '#c9d1d9',
      activeBorder: '#58a6ff',
    },
    ansi: {
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
  },

  // GitHub Light —— 仿 GitHub 浅色界面
  {
    id: 'github-light',
    name: 'GitHub Light',
    type: 'light',
    ui: {
      background: '#ffffff',
      foreground: '#24292f',
      cursor: '#24292f',
      cursorForeground: '#ffffff',
      selection: 'rgba(9, 105, 218, 0.2)',
      selectionForeground: '#24292f',
      activeBorder: '#0969da',
    },
    ansi: {
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f',
    },
  },

  // Ayu Dark —— Ayu 系列暗色变体
  {
    id: 'ayu-dark',
    name: 'Ayu Dark',
    type: 'dark',
    ui: {
      background: '#0b0e14',
      foreground: '#bfbdb6',
      cursor: '#e6b450',
      cursorForeground: '#0b0e14',
      selection: 'rgba(230, 180, 80, 0.2)',
      selectionForeground: '#bfbdb6',
      activeBorder: '#53bdfa',
    },
    ansi: {
      black: '#01060e',
      red: '#ea6c73',
      green: '#91b362',
      yellow: '#f9af4f',
      blue: '#53bdfa',
      magenta: '#fae994',
      cyan: '#90e1c6',
      white: '#c7c7c7',
      brightBlack: '#686868',
      brightRed: '#f07178',
      brightGreen: '#aabbff',
      brightYellow: '#ffffb6',
      brightBlue: '#68a5ff',
      brightMagenta: '#c3a7f5',
      brightCyan: '#95e6cb',
      brightWhite: '#ffffff',
    },
  },

  // Ayu Mirage —— Ayu 系列中等深度变体
  {
    id: 'ayu-mirage',
    name: 'Ayu Mirage',
    type: 'dark',
    ui: {
      background: '#1f2430',
      foreground: '#cbccc6',
      cursor: '#ffcc66',
      cursorForeground: '#1f2430',
      selection: 'rgba(57, 65, 89, 0.6)',
      selectionForeground: '#cbccc6',
      activeBorder: '#73b8ff',
    },
    ansi: {
      black: '#1f2430',
      red: '#ed8274',
      green: '#87d96c',
      yellow: '#ffcc66',
      blue: '#73b8ff',
      magenta: '#d4bfff',
      cyan: '#87d96c',
      white: '#cbccc6',
      brightBlack: '#707a8c',
      brightRed: '#f28779',
      brightGreen: '#95e6cb',
      brightYellow: '#ffcc66',
      brightBlue: '#73b8ff',
      brightMagenta: '#ffb8d2',
      brightCyan: '#95e6cb',
      brightWhite: '#cbccc6',
    },
  },

  // Ayu Light —— Ayu 系列浅色变体
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    type: 'light',
    ui: {
      background: '#fafafa',
      foreground: '#5c6166',
      cursor: '#ff8c40',
      cursorForeground: '#fafafa',
      selection: 'rgba(255, 170, 0, 0.22)',
      selectionForeground: '#1f2430',
      activeBorder: '#ff8c40',
    },
    ansi: {
      black: '#5c6166',
      red: '#f07178',
      green: '#86b300',
      yellow: '#f2ae49',
      blue: '#4db6ff',
      magenta: '#a37acc',
      cyan: '#4dbcc4',
      white: '#fafafa',
      brightBlack: '#828a92',
      brightRed: '#f07178',
      brightGreen: '#86b300',
      brightYellow: '#f2ae49',
      brightBlue: '#4db6ff',
      brightMagenta: '#a37acc',
      brightCyan: '#4dbcc4',
      brightWhite: '#828a92',
    },
  },

  // ─────────────────────────────────────────────────────────────
  // 高人气主题扩展（Rosé Pine / Everforest / Cobalt2 / Night Owl 等）
  // ─────────────────────────────────────────────────────────────

  // Rosé Pine —— Soho vibes 流行的柔和暗色主题
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    type: 'dark',
    ui: {
      background: '#191724',
      foreground: '#e0def4',
      cursor: '#56526e',
      cursorForeground: '#e0def4',
      selection: 'rgba(68, 64, 94, 0.65)',
      selectionForeground: '#e0def4',
      activeBorder: '#ebbcba',
    },
    ansi: {
      black: '#26233a',
      red: '#eb6f92',
      green: '#31748f',
      yellow: '#f6c177',
      blue: '#9ccfd8',
      magenta: '#c4a7e7',
      cyan: '#ebbcba',
      white: '#e0def4',
      brightBlack: '#6e6a86',
      brightRed: '#eb6f92',
      brightGreen: '#31748f',
      brightYellow: '#f6c177',
      brightBlue: '#9ccfd8',
      brightMagenta: '#c4a7e7',
      brightCyan: '#ebbcba',
      brightWhite: '#e0def4',
    },
  },

  // Rosé Pine Moon —— Rosé Pine 的柔和暖色变体
  {
    id: 'rose-pine-moon',
    name: 'Rosé Pine Moon',
    type: 'dark',
    ui: {
      background: '#232136',
      foreground: '#e0def4',
      cursor: '#595469',
      cursorForeground: '#e0def4',
      selection: 'rgba(82, 73, 109, 0.65)',
      selectionForeground: '#e0def4',
      activeBorder: '#ea9a97',
    },
    ansi: {
      black: '#393552',
      red: '#eb6f92',
      green: '#3e8fb0',
      yellow: '#f6c177',
      blue: '#9ccfd8',
      magenta: '#c4a7e7',
      cyan: '#ea9a97',
      white: '#e0def4',
      brightBlack: '#817c9c',
      brightRed: '#eb6f92',
      brightGreen: '#3e8fb0',
      brightYellow: '#f6c177',
      brightBlue: '#9ccfd8',
      brightMagenta: '#c4a7e7',
      brightCyan: '#ea9a97',
      brightWhite: '#e0def4',
    },
  },

  // Rosé Pine Dawn —— Rosé Pine 浅色配套
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    type: 'light',
    ui: {
      background: '#faf4ed',
      foreground: '#575279',
      cursor: '#9893a5',
      cursorForeground: '#faf4ed',
      selection: 'rgba(213, 187, 176, 0.7)',
      selectionForeground: '#575279',
      activeBorder: '#d7827e',
    },
    ansi: {
      black: '#f2e9e4',
      red: '#b4637a',
      green: '#286983',
      yellow: '#ea9d34',
      blue: '#56949f',
      magenta: '#907aa9',
      cyan: '#d7827e',
      white: '#575279',
      brightBlack: '#9893a5',
      brightRed: '#b4637a',
      brightGreen: '#286983',
      brightYellow: '#ea9d34',
      brightBlue: '#56949f',
      brightMagenta: '#907aa9',
      brightCyan: '#d7827e',
      brightWhite: '#575279',
    },
  },

  // Everforest Dark —— 绿色系柔和暗色主题，护眼
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    type: 'dark',
    ui: {
      background: '#2d353b',
      foreground: '#d3c6aa',
      cursor: '#d3c6aa',
      cursorForeground: '#2d353b',
      selection: 'rgba(62, 73, 80, 0.6)',
      selectionForeground: '#d3c6aa',
      activeBorder: '#a7c080',
    },
    ansi: {
      black: '#475258',
      red: '#e67e80',
      green: '#a7c080',
      yellow: '#dbbc7f',
      blue: '#7fbbb3',
      magenta: '#d699b6',
      cyan: '#83c092',
      white: '#d3c6aa',
      brightBlack: '#9da9a0',
      brightRed: '#e67e80',
      brightGreen: '#a7c080',
      brightYellow: '#dbbc7f',
      brightBlue: '#7fbbb3',
      brightMagenta: '#d699b6',
      brightCyan: '#83c092',
      brightWhite: '#d3c6aa',
    },
  },

  // Everforest Light —— Everforest 浅色配套
  {
    id: 'everforest-light',
    name: 'Everforest Light',
    type: 'light',
    ui: {
      background: '#fdf6e3',
      foreground: '#5c6a72',
      cursor: '#5c6a72',
      cursorForeground: '#fdf6e3',
      selection: 'rgba(216, 203, 166, 0.75)',
      selectionForeground: '#3a464c',
      activeBorder: '#35a77c',
    },
    ansi: {
      black: '#5c6a72',
      red: '#f85552',
      green: '#8da101',
      yellow: '#dfa000',
      blue: '#3a94c5',
      magenta: '#df69ba',
      cyan: '#35a77c',
      white: '#dfddc8',
      brightBlack: '#939f91',
      brightRed: '#f85552',
      brightGreen: '#8da101',
      brightYellow: '#dfa000',
      brightBlue: '#3a94c5',
      brightMagenta: '#df69ba',
      brightCyan: '#35a77c',
      brightWhite: '#dfddc8',
    },
  },

  // Cobalt2 —— 蓝色系高人气主题，配色鲜明
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    type: 'dark',
    ui: {
      background: '#193549',
      foreground: '#ffffff',
      cursor: '#ffc600',
      cursorForeground: '#193549',
      selection: 'rgba(0, 136, 255, 0.4)',
      selectionForeground: '#ffffff',
      activeBorder: '#ffc600',
    },
    ansi: {
      black: '#000000',
      red: '#ff0000',
      green: '#37dd6f',
      yellow: '#fee72e',
      blue: '#005fff',
      magenta: '#f800f8',
      cyan: '#00c5e0',
      white: '#ffffff',
      brightBlack: '#686868',
      brightRed: '#ff3334',
      brightGreen: '#27d964',
      brightYellow: '#fee72e',
      brightBlue: '#0082c9',
      brightMagenta: '#f800f8',
      brightCyan: '#00c5e0',
      brightWhite: '#ffffff',
    },
  },

  // Night Owl —— 深蓝色调，适合深夜编码
  {
    id: 'night-owl',
    name: 'Night Owl',
    type: 'dark',
    ui: {
      background: '#011627',
      foreground: '#d6deeb',
      cursor: '#80a4c2',
      cursorForeground: '#011627',
      selection: 'rgba(29, 59, 83, 0.6)',
      selectionForeground: '#d6deeb',
      activeBorder: '#7fdbca',
    },
    ansi: {
      black: '#011627',
      red: '#ef5350',
      green: '#22da6e',
      yellow: '#addb67',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#7fdbca',
      white: '#d6deeb',
      brightBlack: '#7d8bab',
      brightRed: '#ef5350',
      brightGreen: '#22da6e',
      brightYellow: '#ffeb95',
      brightBlue: '#82aaff',
      brightMagenta: '#c792ea',
      brightCyan: '#7fdbca',
      brightWhite: '#ffffff',
    },
  },

  // Night Owl Light —— Night Owl 浅色配套
  {
    id: 'night-owl-light',
    name: 'Night Owl Light',
    type: 'light',
    ui: {
      background: '#fbfbfb',
      foreground: '#403f53',
      cursor: '#90a4ae',
      cursorForeground: '#fbfbfb',
      selection: 'rgba(213, 222, 235, 0.6)',
      selectionForeground: '#403f53',
      activeBorder: '#4876d6',
    },
    ansi: {
      black: '#403f53',
      red: '#daaa01',
      green: '#11d4a4',
      yellow: '#ff6363',
      blue: '#4876d6',
      magenta: '#994cc3',
      cyan: '#0f4b6e',
      white: '#7a7a7a',
      brightBlack: '#7a7a7a',
      brightRed: '#daaa01',
      brightGreen: '#11d4a4',
      brightYellow: '#ff6363',
      brightBlue: '#4876d6',
      brightMagenta: '#994cc3',
      brightCyan: '#0f4b6e',
      brightWhite: '#403f53',
    },
  },

  // Atom One Light —— Atom One Dark 的浅色版本
  {
    id: 'one-light',
    name: 'One Light',
    type: 'light',
    ui: {
      background: '#fafafa',
      foreground: '#383a42',
      cursor: '#526fff',
      cursorForeground: '#fafafa',
      selection: 'rgba(82, 111, 255, 0.15)',
      selectionForeground: '#383a42',
      activeBorder: '#4078f2',
    },
    ansi: {
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#fafafa',
      brightBlack: '#9d9d9d',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff',
    },
  },

  // Snazzy —— Hyper 终端默认主题，鲜艳活泼
  {
    id: 'snazzy',
    name: 'Snazzy',
    type: 'dark',
    ui: {
      background: '#282a36',
      foreground: '#f1f1f0',
      cursor: '#f1f1f0',
      cursorForeground: '#282a36',
      selection: 'rgba(68, 71, 90, 0.5)',
      selectionForeground: '#f1f1f0',
      activeBorder: '#57c7ff',
    },
    ansi: {
      black: '#282a36',
      red: '#ff5c57',
      green: '#5af78e',
      yellow: '#f3f99d',
      blue: '#57c7ff',
      magenta: '#ff6ac1',
      cyan: '#9aedfe',
      white: '#f1f1f0',
      brightBlack: '#686868',
      brightRed: '#ff5c57',
      brightGreen: '#5af78e',
      brightYellow: '#f3f99d',
      brightBlue: '#57c7ff',
      brightMagenta: '#ff6ac1',
      brightCyan: '#9aedfe',
      brightWhite: '#ffffff',
    },
  },

  // Horizon —— 紫红色调的优雅暗色主题
  {
    id: 'horizon',
    name: 'Horizon',
    type: 'dark',
    ui: {
      background: '#1c1e26',
      foreground: '#c69b77',
      cursor: '#d5bba0',
      cursorForeground: '#1c1e26',
      selection: 'rgba(46, 48, 62, 0.6)',
      selectionForeground: '#d5bba0',
      activeBorder: '#df5273',
    },
    ansi: {
      black: '#1c1e26',
      red: '#e93c58',
      green: '#ef7997',
      yellow: '#efa16b',
      blue: '#df5273',
      magenta: '#b072d1',
      cyan: '#24a8b4',
      white: '#c69b77',
      brightBlack: '#6c6f93',
      brightRed: '#e93c58',
      brightGreen: '#ef7997',
      brightYellow: '#efa16b',
      brightBlue: '#df5273',
      brightMagenta: '#b072d1',
      brightCyan: '#24a8b4',
      brightWhite: '#d5bba0',
    },
  },

  // Synthwave '84 —— 80 年代霓虹复古风
  {
    id: 'synthwave-84',
    name: "Synthwave '84",
    type: 'dark',
    ui: {
      background: '#262335',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorForeground: '#262335',
      selection: 'rgba(81, 72, 110, 0.6)',
      selectionForeground: '#f8f8f2',
      activeBorder: '#ff7edb',
    },
    ansi: {
      black: '#262335',
      red: '#fe4450',
      green: '#72f1b8',
      yellow: '#fede5d',
      blue: '#03aeff',
      magenta: '#ff7edb',
      cyan: '#36f9f6',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#fe4450',
      brightGreen: '#72f1b8',
      brightYellow: '#fede5d',
      brightBlue: '#03aeff',
      brightMagenta: '#ff7edb',
      brightCyan: '#36f9f6',
      brightWhite: '#ffffff',
    },
  },

  // Material Ocean —— Material 主题的海洋深蓝变体
  {
    id: 'material-ocean',
    name: 'Material Ocean',
    type: 'dark',
    ui: {
      background: '#0f111a',
      foreground: '#8f93a2',
      cursor: '#ffcb6b',
      cursorForeground: '#0f111a',
      selection: 'rgba(86, 95, 137, 0.4)',
      selectionForeground: '#ffcb6b',
      activeBorder: '#82aaff',
    },
    ansi: {
      black: '#546e7a',
      red: '#ff5370',
      green: '#c3e88d',
      yellow: '#ffcb6b',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#89ddff',
      white: '#eeffff',
      brightBlack: '#546e7a',
      brightRed: '#ff5370',
      brightGreen: '#c3e88d',
      brightYellow: '#ffcb6b',
      brightBlue: '#82aaff',
      brightMagenta: '#c792ea',
      brightCyan: '#89ddff',
      brightWhite: '#ffffff',
    },
  },

  // Material Lighter —— Material 主题浅色变体
  {
    id: 'material-lighter',
    name: 'Material Lighter',
    type: 'light',
    ui: {
      background: '#fafafa',
      foreground: '#546e7a',
      cursor: '#272727',
      cursorForeground: '#fafafa',
      selection: 'rgba(195, 207, 216, 0.65)',
      selectionForeground: '#272727',
      activeBorder: '#6182b8',
    },
    ansi: {
      black: '#546e7a',
      red: '#f07178',
      green: '#c3e88d',
      yellow: '#ffcb6b',
      blue: '#82aaff',
      magenta: '#c792ea',
      cyan: '#89ddff',
      white: '#eeffff',
      brightBlack: '#b2ccd6',
      brightRed: '#f07178',
      brightGreen: '#c3e88d',
      brightYellow: '#ffcb6b',
      brightBlue: '#82aaff',
      brightMagenta: '#c792ea',
      brightCyan: '#89ddff',
      brightWhite: '#ffffff',
    },
  },

  // VS Code Dark+ —— VS Code 默认深色主题
  {
    id: 'vscode-dark-plus',
    name: 'VS Code Dark+',
    type: 'dark',
    ui: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorForeground: '#1e1e1e',
      selection: 'rgba(38, 79, 120, 0.5)',
      selectionForeground: '#d4d4d4',
      activeBorder: '#2472c8',
    },
    ansi: {
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff',
    },
  },

  // Alabaster —— 极简清爽的浅色主题
  {
    id: 'alabaster',
    name: 'Alabaster',
    type: 'light',
    ui: {
      background: '#f7f7f7',
      foreground: '#434343',
      cursor: '#434343',
      cursorForeground: '#f7f7f7',
      selection: 'rgba(215, 215, 215, 0.6)',
      selectionForeground: '#434343',
      activeBorder: '#0083b2',
    },
    ansi: {
      black: '#000000',
      red: '#aa3731',
      green: '#448c27',
      yellow: '#cb9000',
      blue: '#325cc0',
      magenta: '#7a3e9d',
      cyan: '#0083b2',
      white: '#f7f7f7',
      brightBlack: '#777777',
      brightRed: '#f05050',
      brightGreen: '#60cb00',
      brightYellow: '#ffbc5d',
      brightBlue: '#007acc',
      brightMagenta: '#e64ce6',
      brightCyan: '#00aacb',
      brightWhite: '#ffffff',
    },
  },

  // Flat Remix Dark —— 扁平化设计风格的暗色主题
  {
    id: 'flat-remix-dark',
    name: 'Flat Remix Dark',
    type: 'dark',
    ui: {
      background: '#1a1c23',
      foreground: '#dadada',
      cursor: '#dadada',
      cursorForeground: '#1a1c23',
      selection: 'rgba(45, 48, 60, 0.6)',
      selectionForeground: '#dadada',
      activeBorder: '#2980b9',
    },
    ansi: {
      black: '#1a1c23',
      red: '#e74c3c',
      green: '#27ae60',
      yellow: '#f1c40f',
      blue: '#2980b9',
      magenta: '#8e44ad',
      cyan: '#16a085',
      white: '#dadada',
      brightBlack: '#6c7086',
      brightRed: '#e74c3c',
      brightGreen: '#27ae60',
      brightYellow: '#f1c40f',
      brightBlue: '#2980b9',
      brightMagenta: '#8e44ad',
      brightCyan: '#16a085',
      brightWhite: '#ffffff',
    },
  },

  // Fairy Floss —— 糖果色梦幻紫色主题
  {
    id: 'fairy-floss',
    name: 'Fairy Floss',
    type: 'dark',
    ui: {
      background: '#2d2a32',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorForeground: '#2d2a32',
      selection: 'rgba(94, 84, 112, 0.5)',
      selectionForeground: '#f8f8f2',
      activeBorder: '#ffbdfc',
    },
    ansi: {
      black: '#2d2a32',
      red: '#ffb8d1',
      green: '#c5ffd4',
      yellow: '#ffd4a9',
      blue: '#c2b2ff',
      magenta: '#ffbdfc',
      cyan: '#a9ebff',
      white: '#f8f8f2',
      brightBlack: '#6e6a86',
      brightRed: '#ffb8d1',
      brightGreen: '#c5ffd4',
      brightYellow: '#ffd4a9',
      brightBlue: '#c2b2ff',
      brightMagenta: '#ffbdfc',
      brightCyan: '#a9ebff',
      brightWhite: '#ffffff',
    },
  },

  // spacedust —— 深空灰色调，复古太空感
  {
    id: 'spacedust',
    name: 'Spacedust',
    type: 'dark',
    ui: {
      background: '#2a231d',
      foreground: '#9a8b7d',
      cursor: '#9a8b7d',
      cursorForeground: '#2a231d',
      selection: 'rgba(104, 85, 71, 0.65)',
      selectionForeground: '#f0e6d2',
      activeBorder: '#e0a363',
    },
    ansi: {
      black: '#2a231d',
      red: '#b75f48',
      green: '#8c9440',
      yellow: '#d5a249',
      blue: '#5a7793',
      magenta: '#ad6371',
      cyan: '#7e8295',
      white: '#9a8b7d',
      brightBlack: '#6e6053',
      brightRed: '#b75f48',
      brightGreen: '#8c9440',
      brightYellow: '#d5a249',
      brightBlue: '#5a7793',
      brightMagenta: '#ad6371',
      brightCyan: '#7e8295',
      brightWhite: '#d5c4a3',
    },
  },
  {
    id: 'kawaii-dark',
    name: '喵~ 治愈夜喵 (Kawaii Dark)',
    type: 'dark',
    ui: {
      background: '#181524',
      foreground: '#f5e6ee',
      cursor: '#ff7ba9',
      cursorForeground: '#181524',
      selection: 'rgba(255, 123, 169, 0.32)',
      selectionForeground: '#ffffff',
      activeBorder: '#ff7ba9',
    },
    ansi: {
      black: '#524566',
      red: '#ff6e8e',
      green: '#6ee7b7',
      yellow: '#fde047',
      blue: '#70a5ff',
      magenta: '#f472b6',
      cyan: '#38bdf8',
      white: '#f3e8ff',
      brightBlack: '#7d6c96',
      brightRed: '#ff8fa8',
      brightGreen: '#a7f3d0',
      brightYellow: '#fef08a',
      brightBlue: '#93c5fd',
      brightMagenta: '#fbcfe8',
      brightCyan: '#a5f3fc',
      brightWhite: '#ffffff',
    },
  },
  {
    id: 'kawaii-light',
    name: '喵~ 奶芙暖纸 (Kawaii Paper)',
    type: 'light',
    ui: {
      background: '#faf4ee',
      foreground: '#3c3242',
      cursor: '#e05d84',
      cursorForeground: '#faf4ee',
      selection: 'rgba(224, 93, 132, 0.35)',
      selectionForeground: '#2b1a28',
      activeBorder: '#e05d84',
    },
    ansi: {
      black: '#3c3242',
      red: '#ba3860',
      green: '#336c3d',
      yellow: '#9e6212',
      blue: '#2e5699',
      magenta: '#9b487a',
      cyan: '#2b6d7a',
      white: '#6a5868',
      brightBlack: '#6e5d6a',
      brightRed: '#cc3766',
      brightGreen: '#3b7e48',
      brightYellow: '#b06e16',
      brightBlue: '#3562ae',
      brightMagenta: '#ae508b',
      brightCyan: '#307987',
      brightWhite: '#5a4a58',
    },
  },
]

/**
 * 系统预设主题的背景配置覆盖层类型（与 store 中定义一致）。
 * 仅对预设主题生效；自定义主题直接写 theme.background。
 * image/videoPath 也保存在覆盖层中，clearTerminalThemeOverride 可一键恢复默认。
 */
export type TerminalThemeOverride = {
  type?: 'image' | 'video'
  image?: string
  videoPath?: string
  opacity?: number
  blur?: number
  size?: 'cover' | 'contain' | 'center'
  activeBorder?: string
}

export function getTerminalTheme(
  themeId: string,
  customThemes: TerminalTheme[] = [],
  overrides: Record<string, TerminalThemeOverride> = {},
): TerminalTheme {
  const allThemes = [...PRESET_TERMINAL_THEMES, ...customThemes]
  const found = allThemes.find((t) => t.id === themeId) || PRESET_TERMINAL_THEMES[0]
  // 系统预设主题的背景图覆盖层（不修改只读 PRESET 常量）。
  // 自定义主题的 background 直接从 theme 对象读取，不经过此覆盖层。
  const isPreset = PRESET_TERMINAL_THEMES.some((t) => t.id === found.id)
  const override = isPreset ? overrides[found.id] : undefined

  let result: TerminalTheme

  // 兼容老版本本地缓存的扁平主题结构 (Migration wrapper)
  if (found && !found.ui) {
    // 旧版本扁平主题结构（字段可能缺失，全部按可选处理）
    interface LegacyFlatTheme {
      id?: string
      name?: string
      isDark?: boolean
      background?: string
      foreground?: string
      cursor?: string
      cursorForeground?: string
      selection?: string
      selectionForeground?: string
      activeBorder?: string
      black?: string
      red?: string
      green?: string
      yellow?: string
      blue?: string
      magenta?: string
      cyan?: string
      white?: string
      brightBlack?: string
      brightRed?: string
      brightGreen?: string
      brightYellow?: string
      brightBlue?: string
      brightMagenta?: string
      brightCyan?: string
      brightWhite?: string
    }
    const raw = found as unknown as LegacyFlatTheme
    const background = raw.background || '#181824'
    const foreground = raw.foreground || '#b2b2b2'
    result = {
      id: raw.id || 'legacy-theme',
      name: raw.name || 'Legacy Theme',
      type: raw.isDark === false ? 'light' : 'dark',
      ui: {
        background,
        foreground,
        cursor: raw.cursor || '#00ff88',
        // 旧主题缺新字段：cursorForeground 默认用背景色（反色显示光标下字符）
        cursorForeground: raw.cursorForeground || background,
        selection: raw.selection || 'rgba(185, 195, 230, 0.45)',
        // selectionForeground 默认用 foreground（与 xterm 默认行为一致）
        selectionForeground: raw.selectionForeground || foreground,
        activeBorder: raw.activeBorder || (raw.isDark === false ? '#0284c7' : '#38bdf8'),
      },
      ansi: {
        black: raw.black || '#000000',
        red: raw.red || '#f14c4c',
        green: raw.green || '#23d18b',
        yellow: raw.yellow || '#f5f543',
        blue: raw.blue || '#3b8eea',
        magenta: raw.magenta || '#d670d6',
        cyan: raw.cyan || '#29b8db',
        white: raw.white || '#e5e5e5',
        brightBlack: raw.brightBlack || '#666666',
        brightRed: raw.brightRed || '#f14c4c',
        brightGreen: raw.brightGreen || '#23d18b',
        brightYellow: raw.brightYellow || '#f5f543',
        brightBlue: raw.brightBlue || '#3b8eea',
        brightMagenta: raw.brightMagenta || '#d670d6',
        brightCyan: raw.brightCyan || '#29b8db',
        brightWhite: raw.brightWhite || '#ffffff',
      },
    }
  } else if (found && found.ui) {
    // 半迁移：用户在旧版本创建的自定义主题已持久化到 localStorage，
    // 其 ui 对象可能缺少新增的 cursorForeground / selectionForeground 字段。
    // 这里补默认值，避免 xterm.js 下发 undefined 导致渲染异常。
    // 注意：必须返回副本，不能直接修改 found —— 它可能来自 PRESET_TERMINAL_THEMES（只读常量）。
    const bg = found.ui.background
    const fg = found.ui.foreground
    const activeBorder = found.ui.activeBorder || (found.type === 'light' ? '#0284c7' : '#38bdf8')
    if (!found.ui.cursorForeground || !found.ui.selectionForeground || !found.ui.activeBorder) {
      result = {
        ...found,
        ui: {
          ...found.ui,
          cursorForeground: found.ui.cursorForeground || bg,
          selectionForeground: found.ui.selectionForeground || fg,
          activeBorder,
        },
      }
    } else {
      // 预设主题需返回副本，避免调用方修改到 PRESET 常量
      result = isPreset ? { ...found } : found
    }
  } else {
    result = found
  }

  // 合并系统预设主题的背景覆盖层（仅当 override 存在任一字段时生效）。
  // type/image/videoPath/opacity/blur/size 全部来自覆盖层；clearTerminalThemeOverride 清除整个覆盖层即可恢复默认。
  if (override && override.activeBorder !== undefined) {
    result = {
      ...result,
      ui: {
        ...result.ui,
        activeBorder: override.activeBorder,
      },
    }
  }

  if (override && (override.type !== undefined || override.image !== undefined || override.videoPath !== undefined || override.opacity !== undefined || override.blur !== undefined || override.size !== undefined)) {
    result = {
      ...result,
      background: {
        type: override.type,
        image: override.image,
        videoPath: override.videoPath,
        opacity: override.opacity,
        blur: override.blur,
        size: override.size,
      },
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 导入/导出与跟随系统辅助函数
// ─────────────────────────────────────────────────────────────

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGBA_COLOR_RE = /^rgba?\(\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)\s*,\s*(\d{1,3}%?)\s*(?:,\s*([\d.]+)\s*)?\)$/

/** 校验颜色字符串是否为合法的 hex / rgba 格式 */
function isValidColor(s: unknown): s is string {
  if (typeof s !== 'string' || s.length === 0) return false
  return HEX_COLOR_RE.test(s) || RGBA_COLOR_RE.test(s)
}

/**
 * 将颜色（hex 或 rgba）转为带指定 alpha 的 rgba 字符串。
 * 用于背景图模式下，把 xterm theme.background 降为半透明，让容器背景图透出。
 * 输入格式：#rgb / #rrggbb / #rrggbbaa / rgba(r,g,b,a) / rgb(r,g,b)。
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  // hex #rgb / #rgba / #rrggbb / #rrggbbaa
  const hexMatch = color.match(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  if (hexMatch) {
    let h = hexMatch[1]
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
    else if (h.length === 8) h = h.slice(0, 6)
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  // rgba/rgb
  const rgbaMatch = color.match(RGBA_COLOR_RE)
  if (rgbaMatch) {
    const r = rgbaMatch[1]
    const g = rgbaMatch[2]
    const b = rgbaMatch[3]
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  // 无法解析，原样返回（alpha 无法应用）
  return color
}

const ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const

const UI_KEYS = [
  'background', 'foreground', 'cursor', 'cursorForeground',
  'selection', 'selectionForeground',
] as const

/**
 * 校验导入的 JSON 对象是否为合法的 TerminalTheme。
 * 合法性要求：包含 id(字符串) / name(字符串) / type('dark'|'light') /
 *             ui(6 个合法颜色) / ansi(16 个合法颜色)。
 * 返回归一化后的 TerminalTheme，不合法返回 null。
 */
export function validateTerminalTheme(raw: unknown): TerminalTheme | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // id 必须是字符串，且不含空白；导入时允许使用已有 ID（导入方负责重命名）
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null
  if (typeof obj.name !== 'string' || !obj.name.trim()) return null
  if (obj.type !== 'dark' && obj.type !== 'light') return null

  const uiRaw = obj.ui
  const ansiRaw = obj.ansi
  if (!uiRaw || typeof uiRaw !== 'object') return null
  if (!ansiRaw || typeof ansiRaw !== 'object') return null

  const ui = uiRaw as Record<string, unknown>
  const ansi = ansiRaw as Record<string, unknown>

  for (const k of UI_KEYS) {
    // cursorForeground / selectionForeground 等可选字段为 undefined 或空串时跳过校验
    if (ui[k] === undefined || ui[k] === '') continue
    if (!isValidColor(ui[k])) return null
  }
  for (const k of ANSI_KEYS) {
    if (ansi[k] === undefined || ansi[k] === '') continue
    if (!isValidColor(ansi[k])) return null
  }

  // background 字段可选；存在时校验并归一化
  let background: TerminalTheme['background']
  const bgRaw = obj.background
  if (bgRaw !== undefined && bgRaw !== null) {
    if (typeof bgRaw !== 'object') return null
    const bg = bgRaw as Record<string, unknown>
    const type = bg.type === 'image' || bg.type === 'video' ? bg.type : undefined
    const image = typeof bg.image === 'string' ? bg.image : undefined
    const videoPath = typeof bg.videoPath === 'string' ? bg.videoPath : undefined
    const opacity = typeof bg.opacity === 'number' && bg.opacity >= 0 && bg.opacity <= 1
      ? bg.opacity
      : undefined
    const blur = typeof bg.blur === 'number' && bg.blur >= 0 ? bg.blur : undefined
    const size = bg.size === 'cover' || bg.size === 'contain' || bg.size === 'center'
      ? bg.size
      : undefined
    // image 或 videoPath 存在才有意义保存 background 配置
    if (image || videoPath) {
      background = {}
      if (type) background.type = type
      if (image) background.image = image
      if (videoPath) background.videoPath = videoPath
      if (opacity !== undefined) background.opacity = opacity
      if (blur !== undefined) background.blur = blur
      if (size !== undefined) background.size = size
    }
  }

  return {
    id: obj.id.trim(),
    name: obj.name.trim(),
    type: obj.type,
    ui: {
      background: ui.background as string,
      foreground: ui.foreground as string,
      cursor: ui.cursor as string,
      cursorForeground: ui.cursorForeground as string,
      selection: ui.selection as string,
      selectionForeground: ui.selectionForeground as string,
    },
    ...(background ? { background } : {}),
    ansi: {
      black: ansi.black as string,
      red: ansi.red as string,
      green: ansi.green as string,
      yellow: ansi.yellow as string,
      blue: ansi.blue as string,
      magenta: ansi.magenta as string,
      cyan: ansi.cyan as string,
      white: ansi.white as string,
      brightBlack: ansi.brightBlack as string,
      brightRed: ansi.brightRed as string,
      brightGreen: ansi.brightGreen as string,
      brightYellow: ansi.brightYellow as string,
      brightBlue: ansi.brightBlue as string,
      brightMagenta: ansi.brightMagenta as string,
      brightCyan: ansi.brightCyan as string,
      brightWhite: ansi.brightWhite as string,
    },
  }
}

/**
 * 导出主题为 JSON 字符串（带 schema 版本与注释，便于跨应用共享）。
 */
export function serializeTerminalTheme(theme: TerminalTheme): string {
  return JSON.stringify({
    $schema: 'trae-terminal-theme/v1',
    ...theme,
  }, null, 2)
}

/**
 * 在所有主题中按类型查找一个合适的主题，优先匹配 preferredId，
 * 其次匹配第一预设主题（termius-dark/termius-light），最后回退到第一预设。
 */
export function findThemeByType(
  type: 'dark' | 'light',
  preferredId: string | undefined,
  customThemes: TerminalTheme[] = [],
): TerminalTheme {
  const all = [...PRESET_TERMINAL_THEMES, ...customThemes]
  if (preferredId) {
    const hit = all.find((t) => t.id === preferredId && t.type === type)
    if (hit) return hit
  }
  const fallbackId = type === 'dark' ? 'termius-dark' : 'termius-light'
  return all.find((t) => t.id === fallbackId) || PRESET_TERMINAL_THEMES[0]
}

/** 监听系统深浅色变化（仅浏览器环境）。返回取消监听函数。 */
export function watchSystemColorScheme(
  onChange: (isDark: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => onChange(e.matches)
  // Safari < 14 使用 addListener
  if (mql.addEventListener) {
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  } else {
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }
}

/** 立即读取当前系统深浅色偏好 */
export function getSystemColorScheme(): 'dark' | 'light' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

type RgbaColor = { r: number; g: number; b: number; a: number }

function parseThemeColor(color: string | undefined): RgbaColor | null {
  if (!color) return null
  const value = color.trim()
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    const raw = hex[1]
    const expanded = raw.length === 3
      ? raw.split('').map((part) => `${part}${part}`).join('')
      : raw
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
      a: expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    }
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (!rgb) return null
  const percent = value.includes('%')
  const channel = (part: string) => Math.max(0, Math.min(255, Number(part) * (percent ? 2.55 : 1)))
  return {
    r: channel(rgb[1]),
    g: channel(rgb[2]),
    b: channel(rgb[3]),
    a: Math.max(0, Math.min(1, rgb[4] === undefined ? 1 : Number(rgb[4]))),
  }
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  }
}

function relativeLuminance(color: RgbaColor): number {
  const linear = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function colorContrast(first: RgbaColor, second: RgbaColor): number {
  const a = relativeLuminance(first)
  const b = relativeLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function colorDistance(first: RgbaColor, second: RgbaColor): number {
  const red = first.r - second.r
  const green = first.g - second.g
  const blue = first.b - second.b
  return Math.sqrt(red * red + green * green + blue * blue)
}

function rgbaString(color: RgbaColor): string {
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${Number(color.a.toFixed(2))})`
}

/**
 * 统一保证终端选区既能从背景中辨认，也能清晰阅读选中文字。
 * 优先保留主题原有色相，仅在对比不足时提高透明度；仍不足才使用主题蓝色，
 * 最后才回退到深浅反色。这样预置主题保持各自风格，同时避免选区“看不见”。
 */
export function resolveTerminalSelectionColors(theme: TerminalTheme): {
  background: string
  foreground: string
  areaContrast: number
  textContrast: number
} {
  const base = parseThemeColor(theme.ui.background)
  const originalSelection = parseThemeColor(theme.ui.selection)
  const configuredForeground = parseThemeColor(
    theme.ui.selectionForeground || theme.ui.foreground,
  )
  if (!base || !originalSelection) {
    return {
      background: theme.ui.selection,
      foreground: theme.ui.selectionForeground || theme.ui.foreground,
      areaContrast: 0,
      textContrast: 0,
    }
  }


  // 自定义/导入主题中的颜色是用户的明确配置，必须原样交给 xterm。
  // 之前这里也执行预置主题的自动可读性校正，导致设置面板显示 #cc1e64，
  // 实际终端却渲染成自动挑选的深色，形成“配置与效果对不上”。预置主题仍由
  // 下方逻辑做安全校正；用户可编辑的主题则以所见即所得为最高优先级。
  const isPresetTheme = PRESET_TERMINAL_THEMES.some(item => item.id === theme.id)
  if (!isPresetTheme) {
    const visibleSelection = compositeColor(originalSelection, base)
    return {
      background: theme.ui.selection,
      foreground: theme.ui.selectionForeground || theme.ui.foreground,
      areaContrast: colorContrast(visibleSelection, base),
      textContrast: configuredForeground
        ? colorContrast(configuredForeground, visibleSelection)
        : 0,
    }
  }

  const minimumAreaContrast = 2.4
  const hasBackgroundMedia = !!(theme.background?.image || theme.background?.videoPath)
  const improveCandidate = (source: RgbaColor, minimumAlpha: number) => {
    let candidate = { ...source, a: Math.max(source.a, minimumAlpha) }
    while (candidate.a < 0.9 && colorContrast(compositeColor(candidate, base), base) < minimumAreaContrast) {
      candidate = { ...candidate, a: Math.min(0.9, candidate.a + 0.05) }
    }
    return candidate
  }

  let selection = improveCandidate(originalSelection, hasBackgroundMedia ? 0.68 : originalSelection.a)
  let visibleSelection = compositeColor(selection, base)
  if (colorContrast(visibleSelection, base) < minimumAreaContrast) {
    const accent = parseThemeColor(theme.ansi.blue) || parseThemeColor(theme.ui.cursor)
    if (accent) {
      selection = improveCandidate({ ...accent, a: 0.42 }, hasBackgroundMedia ? 0.68 : 0.42)
      visibleSelection = compositeColor(selection, base)
    }
  }
  if (colorContrast(visibleSelection, base) < minimumAreaContrast) {
    selection = improveCandidate(
      theme.type === 'light'
        ? { r: 0, g: 72, b: 160, a: 0.38 }
        : { r: 120, g: 170, b: 255, a: 0.42 },
      hasBackgroundMedia ? 0.72 : 0.42,
    )
    visibleSelection = compositeColor(selection, base)
  }

  const normalForeground = parseThemeColor(theme.ui.foreground)
  const foregroundCandidates = [
    theme.ui.selectionForeground,
    '#ffffff',
    '#10131a',
    theme.ui.foreground,
  ]
    .map(parseThemeColor)
    .filter((color): color is RgbaColor => !!color)
  const readableCandidates = foregroundCandidates.filter(
    candidate => colorContrast(candidate, visibleSelection) >= 4.5,
  )
  // 很多导入主题把 selectionForeground 配成普通 foreground，虽然 xterm 已经应用，
  // 肉眼仍会误以为只有背景色生效。可读性相同时优先选择与普通文字有明显差异的
  // 黑/白前景色；若当前选区背景无法承载不同颜色，再保留对比度最高的可读颜色。
  const visiblyDifferentCandidates = normalForeground
    ? readableCandidates.filter(candidate => colorDistance(candidate, normalForeground) >= 36)
    : readableCandidates
  const candidatesToRank = visiblyDifferentCandidates.length > 0
    ? visiblyDifferentCandidates
    : readableCandidates.length > 0
      ? readableCandidates
      : foregroundCandidates
  let selectedForeground = candidatesToRank[0]
  for (const candidate of candidatesToRank.slice(1)) {
    if (!selectedForeground || colorContrast(candidate, visibleSelection) > colorContrast(selectedForeground, visibleSelection)) {
      selectedForeground = candidate
    }
  }

  return {
    background: rgbaString(selection),
    foreground: selectedForeground
      ? `rgb(${Math.round(selectedForeground.r)}, ${Math.round(selectedForeground.g)}, ${Math.round(selectedForeground.b)})`
      : theme.ui.selectionForeground || theme.ui.foreground,
    areaContrast: colorContrast(visibleSelection, base),
    textContrast: selectedForeground ? colorContrast(selectedForeground, visibleSelection) : 0,
  }
}

/**
 * 将 TerminalTheme 映射为 xterm.js 的 ITheme 对象。
 * 抽取为共享函数，避免在 terminal.tsx 的多个 useEffect 中重复维护同一份映射。
 */
export function themeToXtermTheme(theme: TerminalTheme, cursorStyle: 'block' | 'underline' | 'bar' = 'bar') {
  // 背景媒体模式（图片或视频）下，canvas 完全透明（只绘制文字），压暗色改由
  // .xterm 元素自身的 background-color 提供（通过 --xterm-bg-overlay CSS 变量注入）。
  // 原因：canvas 高度 = rows × cellHeight（fit() 计算），不填满 height:100% 的 .xterm，
  // 若由 canvas 压暗，canvas 未覆盖的底部区域会透出纯背景图，产生色差/留白。
  // 必须用 rgba(r,g,b,0) 而非 'transparent' 字符串——xterm canvas 渲染器对
  // 'transparent' 字符串支持不稳定（部分版本会忽略 alpha 直接绘制不透明背景）。
  // 仅在无背景媒体时保持原色；opacity 只控制宿主层的压暗程度，
  // 不能决定 canvas 是否透明，否则标签切换后的 fit/refresh 会遮住媒体。
  const hasBgMedia = !!(theme.background?.image || theme.background?.videoPath)
  let background: string
  if (hasBgMedia) {
    background = 'rgba(0, 0, 0, 0)'
  } else {
    background = theme.ui.background
  }
  // 滚动条滑块颜色：xterm 默认用 foreground 的 20% 透明度，
  // 当 foreground 与背景色接近时滑块会看不见。这里按主题类型强制反色：
  // 亮主题用暗条（黑色），暗主题用亮条（白色），确保在任意主题下都清晰可见。
  // 透明度三档：默认 0.35 / hover 0.5 / active 0.6。
  const isLight = theme.type === 'light'
  const sliderBase = isLight ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.45)'
  const sliderHover = isLight ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)'
  const sliderActive = isLight ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.85)'
  const accessibleSelection = resolveTerminalSelectionColors(theme)
  return {
    background,
    foreground: theme?.ui?.foreground,
    cursor: theme?.ui?.cursor,
    // 仅在实心块状光标(block)下使用 cursorForeground（在实心色块上反色显示文字）。
    // 竖线(bar)或下划线(underline)光标下，字符背景并非实心块，若传递 cursorForeground（通常等于背景色），
    // xterm 会强行将光标处的字符绘制为背景色，导致光标所在位置 / 选中选区首字文字变成背景色而隐形消失。
    cursorForeground: cursorStyle === 'block' ? theme?.ui?.cursorForeground : undefined,
    selectionBackground: accessibleSelection.background,
    // 显式指定选区前景色，避免 ANSI 彩色文本在选区中继续使用原色，
    // 造成首字符看起来像未选中或与相邻字符颜色不一致。
    selectionForeground: accessibleSelection.foreground,
    selectionInactiveBackground: accessibleSelection.background,
    scrollbarSliderBackground: sliderBase,
    scrollbarSliderHoverBackground: sliderHover,
    scrollbarSliderActiveBackground: sliderActive,
    black: theme?.ansi?.black || '#000000',
    red: theme?.ansi?.red || '#f14c4c',
    green: theme?.ansi?.green || '#23d18b',
    yellow: theme?.ansi?.yellow || '#f5f543',
    blue: theme?.ansi?.blue || '#3b8eea',
    magenta: theme?.ansi?.magenta || '#d670d6',
    cyan: theme?.ansi?.cyan || '#29b8db',
    white: theme?.ansi?.white || '#e5e5e5',
    brightBlack: theme?.ansi?.brightBlack || '#666666',
    brightRed: theme?.ansi?.brightRed || '#f14c4c',
    brightGreen: theme?.ansi?.brightGreen || '#23d18b',
    brightYellow: theme?.ansi?.brightYellow || '#f5f543',
    brightBlue: theme?.ansi?.brightBlue || '#3b8eea',
    brightMagenta: theme?.ansi?.brightMagenta || '#d670d6',
    brightCyan: theme?.ansi?.brightCyan || '#29b8db',
    brightWhite: theme?.ansi?.brightWhite || '#ffffff',
  }
}

/**
 * 计算终端背景媒体的压暗色（overlay），用于 .xterm 元素自身的 background-color。
 *
 * 背景媒体模式下，canvas 完全透明（只画文字），压暗色改由 .xterm 自身提供，
 * 确保整个 .xterm 区域（含 canvas 未覆盖的底部）统一"背景图 + 压暗色"。
 *
 * @returns rgba 压暗色字符串；无背景媒体或未设 opacity 时返回 'transparent'（不压暗）
 */
export function getTerminalBgOverlay(theme: TerminalTheme): string {
  const hasBgMedia = !!(theme.background?.image || theme.background?.videoPath)
  const bgOpacity = theme.background?.opacity
  if (!hasBgMedia || typeof bgOpacity !== 'number') return 'transparent'
  // opacity=1 时限制为 0.95，确保背景至少有 5% 透出（与原 themeToXtermTheme 逻辑一致）
  const effectiveAlpha = bgOpacity >= 1 ? 0.95 : bgOpacity
  return withAlpha(theme.ui.background, effectiveAlpha)
}
