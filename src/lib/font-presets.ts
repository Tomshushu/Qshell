// 常用终端字体选项预设 (与 Xshell 保持一致)
// 独立文件，避免 store <-> terminal.tsx 循环依赖
export const FONT_PRESETS = [
  // Cascadia Code & Mono variants
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { label: 'Cascadia Code Light', value: '"Cascadia Code Light", monospace' },
  { label: 'Cascadia Code SemiBold', value: '"Cascadia Code SemiBold", monospace' },
  { label: 'Cascadia Code ExtraLight', value: '"Cascadia Code ExtraLight", monospace' },
  { label: 'Cascadia Mono', value: '"Cascadia Mono", monospace' },
  { label: 'Cascadia Mono Light', value: '"Cascadia Mono Light", monospace' },
  { label: 'Cascadia Mono SemiBold', value: '"Cascadia Mono SemiBold", monospace' },
  { label: 'Cascadia Mono ExtraLight', value: '"Cascadia Mono ExtraLight", monospace' },
  // Professional Mono Fonts (Requested list)
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'DejaVu Sans Mono', value: '"DejaVu Sans Mono", monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  // Chinese Fonts (Xshell standard)
  { label: '新宋体 / SimSun', value: 'SimSun, "新宋体", monospace' },
  { label: '仿宋 / FangSong', value: 'FangSong, "仿宋", monospace' },
  { label: '楷体 / KaiTi', value: 'KaiTi, "楷体", monospace' },
  { label: '黑体 / SimHei', value: 'SimHei, "黑体", monospace' },
  { label: '幼圆 / YouYuan', value: 'YouYuan, "幼圆", monospace' },
  { label: '隶书 / LiSu', value: 'LiSu, "隶书", monospace' },
]

// CJK / 非 ASCII 字体预设（双重字体第二段）。
// 值只写字体族名，不追加 monospace（由 composeTerminalFontFamily 统一补齐），
// 否则通用回退会抢先接管中文字形，独立 CJK 字体失效。
export const CJK_FONT_PRESETS = [
  { label: '微软雅黑 / Microsoft YaHei', value: '"Microsoft YaHei", "微软雅黑"' },
  { label: '新宋体 / SimSun', value: 'SimSun, "新宋体"' },
  { label: '黑体 / SimHei', value: 'SimHei, "黑体"' },
  { label: '仿宋 / FangSong', value: 'FangSong, "仿宋"' },
  { label: '楷体 / KaiTi', value: 'KaiTi, "楷体"' },
  { label: '幼圆 / YouYuan', value: 'YouYuan, "幼圆"' },
  { label: '苹方 / PingFang SC', value: '"PingFang SC"' },
  { label: 'Noto Sans CJK SC', value: '"Noto Sans CJK SC"' },
  { label: 'Sarasa Mono SC', value: '"Sarasa Mono SC"' },
]
