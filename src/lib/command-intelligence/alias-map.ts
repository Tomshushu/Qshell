/**
 * 常见 Shell 别名表
 *
 * 这些别名（ll / la / .. 等）不在命令库中，但用户经常输入。
 * 当用户在命令名阶段输入匹配别名时，提示「alias → ls -alF」，
 * 让用户知道该别名展开后的真实命令。
 *
 * 仅收录「非真实命令」的别名，避免与命令库冲突。
 * 数值参考 bash/zsh 默认配置与运维惯例。
 */

/** 别名 → 展开 */
export const COMMON_ALIASES: Record<string, string> = {
  ll: 'ls -alF',
  la: 'ls -A',
  l: 'ls -CF',
  lh: 'ls -lah',
  lt: 'ls -ltr',
  lll: 'ls -l --block-size=M',
  '..': 'cd ..',
  '...': 'cd ../..',
  '....': 'cd ../../..',
  '.2': 'cd ../..',
  '.3': 'cd ../../..',
  cls: 'clear',
  clr: 'clear',
  h: 'history',
  j: 'jobs',
  p: 'pwd',
  md: 'mkdir -p',
  rd: 'rmdir',
  ports: 'netstat -tulanp',
  listening: 'ss -tunlp',
  flush: 'sudo sync && sudo sysctl -w vm.drop_caches=3',
  extract: 'tar -xvf',
  tarlist: 'tar -tvf',
  path: 'echo $PATH',
  reload: 'source ~/.bashrc',
  bashrc: 'vim ~/.bashrc',
  zshrc: 'vim ~/.zshrc',
  vimrc: 'vim ~/.vimrc',
  hosts: 'sudo vim /etc/hosts',
  pp: 'ps -ef | head',
  dfh: 'df -h',
  duh: 'du -h --max-depth=1',
  mem: 'free -m',
  cpu: 'cat /proc/cpuinfo',
  ipinfo: 'ip addr show',
  extip: 'curl -s ifconfig.me',
  myip: 'curl -s ifconfig.me',
  ping5: 'ping -c 5',
  wget1: 'wget --limit-rate=1m',
  // 注意：不收录与真实命令同名的别名（如 grep / ls / ll 等），
  // 否则命令库与别名表会同时返回同名候选项，造成重复显示。
  // 真实命令的别名增强（如 grep --color=auto）应由 shell 自身处理。
}

/**
 * 取匹配前缀的别名（用于命令名阶段补全）。
 *
 * @param q 用户当前输入
 * @param max 最大返回条数
 * @returns [别名, 展开] 列表，按别名长度升序（短在前）
 */
export function matchAliases(q: string, max = 5): Array<{ name: string; expandsTo: string }> {
  if (!q) return []
  const lower = q.toLowerCase()
  const result: Array<{ name: string; expandsTo: string }> = []
  for (const [name, expandsTo] of Object.entries(COMMON_ALIASES)) {
    if (name.toLowerCase().startsWith(lower)) {
      result.push({ name, expandsTo })
    }
  }
  // 短名在前（更通用的别名优先）；相同长度按字典序
  result.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
  return result.slice(0, max)
}

/**
 * 判断给定名称是否为已注册别名。
 *
 * 用于纠错逻辑前置判断：用户输入完整别名（如 'll'）时，
 * 即使匹配列表为空也不应触发「Did you mean」（与已知命令同等处理）。
 */
export function isKnownAlias(name: string): boolean {
  return COMMON_ALIASES[name] !== undefined
}
