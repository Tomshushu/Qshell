import type { CommandSpec } from '@/lib/command-intelligence/types'

// 杂项工具命令
// 注：echo/printf/man/which/xargs/nohup/test/true/false/env/export/alias/unalias/source
// 已在 shell-builtin.ts 或 text.ts 中定义，此处不再重复，避免 COMMAND_BY_NAME 覆盖。
export const miscCommands: CommandSpec[] = [
  {
    cmd: 'whereis',
    desc: '命令位置',
    category: 'misc',
    params: [
      { name: '-b', desc: '二进制', type: 'flag' },
      { name: '-m', desc: '手册', type: 'flag' },
      { name: '-s', desc: '源码', type: 'flag' },
    ],
    positional: [{ name: '<cmd>', desc: '命令名', type: 'value' }],
  },
  {
    cmd: 'watch',
    desc: '周期执行',
    category: 'misc',
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
    positional: [{ name: '<cmd>', desc: '命令', type: 'vararg' }],
  },
  {
    cmd: 'sleep',
    desc: '休眠',
    category: 'misc',
    positional: [{ name: '<sec>', desc: '秒数', type: 'value' }],
  },
  {
    cmd: 'seq',
    desc: '生成序列',
    category: 'misc',
    params: [{ name: '-s', desc: '分隔符', requiresValue: true, valueHint: '<sep>' }],
    positional: [{ name: '<n>', desc: '数字', type: 'value', repeatable: true }],
  },
  {
    cmd: 'kubectl',
    desc: 'Kubernetes',
    category: 'misc',
    subcommands: [
      { cmd: 'get', desc: '获取资源', positional: [
        { name: '<type>', desc: 'pod|svc|deploy|node|ns', type: 'value' },
        { name: '<name>', desc: '名称', type: 'value' },
      ]},
      { cmd: 'describe', desc: '详情', positional: [
        { name: '<type>', desc: '资源类型', type: 'value' },
        { name: '<name>', desc: '名称', type: 'value' },
      ]},
      { cmd: 'apply', desc: '应用配置', params: [{ name: '-f', desc: '文件', requiresValue: true, valueHint: '<file>' }] },
      { cmd: 'delete', desc: '删除', positional: [{ name: '<type>', desc: '类型', type: 'value' }, { name: '<name>', desc: '名称', type: 'value' }] },
      { cmd: 'logs', desc: '日志', params: [{ name: '-f', desc: '追踪', type: 'flag' }], positional: [{ name: '<pod>', desc: 'pod', type: 'value' }] },
      { cmd: 'exec', desc: '执行', params: [{ name: '-it', desc: '交互', type: 'flag' }], positional: [{ name: '<pod>', desc: 'pod', type: 'value' }] },
      { cmd: 'config', desc: '配置', subcommands: [
        { cmd: 'use-context', desc: '切换上下文', positional: [{ name: '<ctx>', desc: '上下文', type: 'value' }] },
        { cmd: 'get-contexts', desc: '列出上下文', params: [] },
      ]},
      { cmd: 'scale', desc: '扩缩容', positional: [{ name: '<deploy>', desc: 'deployment', type: 'value' }], params: [{ name: '--replicas', desc: '副本数', requiresValue: true, valueHint: '<n>' }] },
    ],
    params: [
      { name: '-n', desc: '命名空间', requiresValue: true, valueHint: '<ns>' },
      { name: '--all-namespaces', desc: '所有命名空间', type: 'flag' },
    ],
    examples: [
      { cmd: 'kubectl get pods -A', desc: '查看所有命名空间的 pod' },
      { cmd: 'kubectl exec -it nginx -- bash', desc: '进入 pod' },
    ],
  },
  {
    cmd: 'helm',
    desc: 'Helm',
    category: 'misc',
    subcommands: [
      { cmd: 'install', desc: '安装', positional: [{ name: '<name>', desc: '名称', type: 'value' }, { name: '<chart>', desc: 'chart', type: 'value' }] },
      { cmd: 'uninstall', desc: '卸载', positional: [{ name: '<name>', desc: '名称', type: 'value' }] },
      { cmd: 'upgrade', desc: '升级', positional: [{ name: '<name>', desc: '名称', type: 'value' }, { name: '<chart>', desc: 'chart', type: 'value' }] },
      { cmd: 'list', desc: '列表', params: [{ name: '-A', desc: '全部命名空间', type: 'flag' }] },
      { cmd: 'repo', desc: '仓库', subcommands: [
        { cmd: 'add', desc: '添加', positional: [{ name: '<name>', desc: '名称', type: 'value' }, { name: '<url>', desc: 'URL', type: 'value' }] },
        { cmd: 'update', desc: '更新', params: [] },
        { cmd: 'list', desc: '列表', params: [] },
      ]},
      { cmd: 'search', desc: '搜索', positional: [{ name: '<keyword>', desc: '关键词', type: 'value' }] },
    ],
  },
]
