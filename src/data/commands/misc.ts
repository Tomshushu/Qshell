import type { CommandSpec } from '@/lib/command-intelligence/types'

// 杂项工具命令
// 注：echo/printf/man/which/xargs/nohup/test/true/false/env/export/alias/unalias/source/whereis/seq
// 已在 shell-builtin.ts、file.ts 或 text.ts 中定义，此处不再重复，避免 COMMAND_BY_NAME 覆盖。
export const miscCommands: CommandSpec[] = [
  {
    cmd: 'watch',
    desc: '周期执行',
    category: 'misc',
    platforms: ['universal'],
    params: [
      { name: '-n', desc: '间隔秒', requiresValue: true, valueHint: '<sec>' },
      { name: '-d', desc: '高亮差异', type: 'flag' },
    ],
    positional: [{ name: '<cmd>', desc: '命令', type: 'vararg' }],
    examples: [{ cmd: 'watch -n 1 date', desc: '每秒刷新日期' }],
  },
  {
    cmd: 'time',
    desc: '计时',
    category: 'misc',
    platforms: ['universal'],
    positional: [{ name: '<cmd>', desc: '命令', type: 'vararg' }],
  },
  {
    cmd: 'sleep',
    desc: '休眠',
    category: 'misc',
    platforms: ['universal'],
    positional: [{ name: '<sec>', desc: '秒数', type: 'value' }],
  },
]
