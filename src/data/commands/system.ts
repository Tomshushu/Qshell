import type { CommandSpec } from '@/lib/command-intelligence/types'

// 系统管理类命令（进程管理 + 日期时间 + 电源）
// 注意：systemctl/journalctl 已移至 devops.ts，df/du/free 已移至 disk-fs.ts，
// uname/uptime/hostname/hostnamectl 已移至 hardware.ts，
// who/whoami/id/su/sudo 已移至 user-perm.ts，
// crontab 已移至 devops.ts，history/exit 已移至 shell-builtin.ts
export const systemCommands: CommandSpec[] = [
  {
    cmd: 'ps',
    desc: '查看进程',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: 'aux', desc: '所有进程详细', type: 'flag' },
      { name: '-ef', desc: '所有进程完整', type: 'flag' },
      { name: '-u', desc: '指定用户', requiresValue: true, valueHint: '<user>' },
      { name: '-p', desc: '指定PID', requiresValue: true, valueHint: '<pid>' },
      { name: '--sort', desc: '排序', requiresValue: true, valueHint: '-%mem' },
    ],
    examples: [
      { cmd: 'ps aux', desc: '查看所有进程' },
      { cmd: 'ps -ef | grep nginx', desc: '查找 nginx 进程' },
    ],
  },
  {
    cmd: 'top',
    desc: '实时进程监控',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '-p', desc: '指定PID', requiresValue: true, valueHint: '<pid>' },
      { name: '-u', desc: '指定用户', requiresValue: true, valueHint: '<user>' },
      { name: '-b', desc: '批处理模式', type: 'flag' },
      { name: '-n', desc: '迭代次数', requiresValue: true, valueHint: '<n>' },
    ],
  },
  {
    cmd: 'htop',
    desc: '增强版 top',
    category: 'system',
    platforms: ['universal'],
  },
  {
    cmd: 'kill',
    desc: '终止进程',
    category: 'system',
    platforms: ['universal'],
    usage: 'kill [SIGNAL] PID...',
    params: [
      { name: '-9', desc: 'SIGKILL 强杀', type: 'flag' },
      { name: '-15', desc: 'SIGTERM 优雅终止', type: 'flag' },
      { name: '-HUP', desc: '重载配置', type: 'flag' },
      { name: '-l', desc: '列出信号', type: 'flag' },
    ],
    positional: [{ name: '<pid>', desc: '进程ID', type: 'value', repeatable: true }],
    examples: [
      { cmd: 'kill -9 1234', desc: '强杀进程' },
      { cmd: 'kill -HUP $(pgrep nginx)', desc: '重载 nginx' },
    ],
  },
  {
    cmd: 'killall',
    desc: '按名终止',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '-9', desc: '强杀', type: 'flag' },
      { name: '-u', desc: '指定用户', requiresValue: true, valueHint: '<user>' },
    ],
    positional: [{ name: '<name>', desc: '进程名', type: 'value' }],
  },
  {
    cmd: 'pkill',
    desc: '按名/模式终止',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '匹配完整命令行', type: 'flag' },
      { name: '-u', desc: '指定用户', requiresValue: true, valueHint: '<user>' },
    ],
    positional: [{ name: '<pattern>', desc: '匹配模式', type: 'value' }],
  },
  {
    cmd: 'pgrep',
    desc: '按名查找PID',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '-f', desc: '匹配完整命令行', type: 'flag' },
      { name: '-l', desc: '显示进程名', type: 'flag' },
    ],
    positional: [{ name: '<pattern>', desc: '匹配模式', type: 'value' }],
  },
  {
    cmd: 'date',
    desc: '日期时间',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '+%Y-%m-%d', desc: '格式化', type: 'flag' },
      { name: '-d', desc: '指定时间', requiresValue: true, valueHint: '<time>' },
      { name: '-u', desc: 'UTC', type: 'flag' },
      { name: '-s', desc: '设置时间', requiresValue: true, valueHint: '<time>' },
    ],
  },
  {
    cmd: 'timedatectl',
    desc: '时区管理',
    category: 'system',
    platforms: ['universal'],
    subcommands: [
      { cmd: 'status', desc: '状态', params: [] },
      { cmd: 'set-timezone', desc: '设置时区', params: [], positional: [{ name: '<tz>', desc: '时区' }] },
      { cmd: 'list-timezones', desc: '列出时区', params: [] },
    ],
  },
  {
    cmd: 'shutdown',
    desc: '关机',
    category: 'system',
    platforms: ['universal'],
    params: [
      { name: '-r', desc: '重启', type: 'flag' },
      { name: '-h', desc: '关机', type: 'flag' },
      { name: 'now', desc: '立即', type: 'flag' },
    ],
    examples: [
      { cmd: 'shutdown -h now', desc: '立即关机' },
      { cmd: 'shutdown -r +5', desc: '5分钟后重启' },
    ],
  },
  {
    cmd: 'reboot',
    desc: '重启',
    category: 'system',
    platforms: ['universal'],
  },
  {
    cmd: 'clear',
    desc: '清屏',
    category: 'system',
    platforms: ['universal'],
  },
]
