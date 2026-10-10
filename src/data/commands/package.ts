import type { CommandSpec } from '@/lib/command-intelligence/types'

// Rust 包管理（其余包管理命令已移至 package-managers.ts）
export const packageCommands: CommandSpec[] = [
  {
    cmd: 'cargo',
    desc: 'Rust 包管理',
    category: 'package-manager',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'build', desc: '构建', params: [{ name: '--release', desc: '发布', type: 'flag' }] },
      { cmd: 'run', desc: '运行', params: [] },
      { cmd: 'test', desc: '测试', params: [] },
      { cmd: 'add', desc: '添加依赖', positional: [{ name: '<crate>', desc: 'crate', type: 'value' }] },
      { cmd: 'update', desc: '更新', params: [] },
      { cmd: 'doc', desc: '文档', params: [{ name: '--open', desc: '打开', type: 'flag' }] },
      { cmd: 'check', desc: '检查', params: [] },
      { cmd: 'fmt', desc: '格式化', params: [] },
    ],
  },
]
