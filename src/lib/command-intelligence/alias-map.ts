/**
 * 常见 Shell 别名表
 *
 * 这些别名（ll / la / .. 等）不在命令库中，但用户经常输入。
 * 当用户在命令名阶段输入匹配别名时，提示「alias → ls -alF」，
 * 让用户知道该别名展开后的真实命令。
 *
 * 仅收录「非真实命令」的别名，避免与命令库冲突。
 * 数值参考 bash/zsh 默认配置与运维惯例。
 *
 * 除内置别名外，还支持按 serverId 注册「从远端 shell 配置读取到的真实别名」
 * （见 setUserAliases / parseAliasOutput），用户自定义别名也能参与补全。
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

/** 用户真实 shell 配置中的别名（按 serverId 隔离） */
const userAliasesByServer = new Map<string, Array<{ name: string; expandsTo: string }>>()
/** 已尝试读取过别名的 server（无论成功与否，避免重复请求） */
const userAliasesLoaded = new Set<string>()

/** 注册某服务器读取到的用户别名（覆盖旧值） */
export function setUserAliases(
  serverId: string,
  aliases: Array<{ name: string; expandsTo: string }>,
): void {
  userAliasesByServer.set(serverId, aliases)
  userAliasesLoaded.add(serverId)
}

/** 该服务器的用户别名是否已尝试读取过 */
export function isUserAliasesLoaded(serverId: string): boolean {
  return userAliasesLoaded.has(serverId)
}

/** 清空用户别名缓存（serverId 缺省时全清） */
export function clearUserAliases(serverId?: string): void {
  if (serverId) {
    userAliasesByServer.delete(serverId)
    userAliasesLoaded.delete(serverId)
  } else {
    userAliasesByServer.clear()
    userAliasesLoaded.clear()
  }
}

/**
 * 解析 shell 配置文本中的 `alias name=value` 定义。
 *
 * 兼容：
 * - `alias ll='ls -alF'` / `alias ll="ls -alF"` / `alias ll=ls`
 * - 行首缩进、行尾注释（`#` 之后的忽略）
 * - 同名别名只保留第一条
 */
export function parseAliasOutput(output: string): Array<{ name: string; expandsTo: string }> {
  const result: Array<{ name: string; expandsTo: string }> = []
  const seen = new Set<string>()
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^alias\s+([^\s=]+)=(.*)$/)
    if (!m) continue

    const name = m[1]
    let expandsTo = m[2].trim()
    const quoted =
      (expandsTo.startsWith("'") && expandsTo.endsWith("'")) ||
      (expandsTo.startsWith('"') && expandsTo.endsWith('"'))
    if (quoted) {
      // 引号包裹：去掉引号，内部的 # 视为字面量
      expandsTo = expandsTo.slice(1, -1)
    } else {
      // 无引号：去掉形如「  # 注释」的行尾注释（# 前需有空白，避免误伤 URL 片段）
      const hashIdx = expandsTo.search(/\s#/)
      if (hashIdx >= 0) expandsTo = expandsTo.slice(0, hashIdx).trim()
    }
    if (!name || !expandsTo || seen.has(name)) continue
    seen.add(name)
    result.push({ name, expandsTo })
  }
  return result
}

/** 合并内置别名 + 用户别名（用户别名优先覆盖同名内置项） */
function aliasEntries(serverId?: string): Array<{ name: string; expandsTo: string }> {
  const base = Object.entries(COMMON_ALIASES).map(([name, expandsTo]) => ({ name, expandsTo }))
  if (!serverId) return base
  const user = userAliasesByServer.get(serverId)
  if (!user || user.length === 0) return base
  const userNames = new Set(user.map((a) => a.name))
  return [...user, ...base.filter((a) => !userNames.has(a.name))]
}

/**
 * 取匹配前缀的别名（用于命令名阶段补全）。
 *
 * @param q 用户当前输入
 * @param max 最大返回条数
 * @param serverId 服务器 ID（传入时合并该服务器读取到的用户别名）
 * @returns [别名, 展开] 列表，按别名长度升序（短在前）
 */
export function matchAliases(
  q: string,
  max = 5,
  serverId?: string,
): Array<{ name: string; expandsTo: string }> {
  if (!q) return []
  const lower = q.toLowerCase()
  const result = aliasEntries(serverId).filter((a) => a.name.toLowerCase().startsWith(lower))
  // 短名在前（更通用的别名优先）；相同长度按字典序
  result.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name))
  return result.slice(0, max)
}

/**
 * 判断给定名称是否为已注册别名（内置或用户自定义）。
 *
 * 用于纠错逻辑前置判断：用户输入完整别名（如 'll'）时，
 * 即使匹配列表为空也不应触发「Did you mean」（与已知命令同等处理）。
 */
export function isKnownAlias(name: string, serverId?: string): boolean {
  if (COMMON_ALIASES[name] !== undefined) return true
  if (!serverId) return false
  const user = userAliasesByServer.get(serverId)
  return !!user && user.some((a) => a.name === name)
}
