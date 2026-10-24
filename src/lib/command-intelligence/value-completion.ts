/**
 * 参数值智能补全（静态）
 *
 * 对某些命令，其位置参数或参数值有「高频取值」可静态枚举。
 * 例如 chmod <MODE> → 755 / 644 / 777 / +x 等。
 *
 * 与动态 Provider 的区别：动态 Provider 实时查询服务器资源（容器名、分支名），
 * 而本模块提供的是命令本身的固有常用取值，无需联网。
 *
 * 引擎在「位置参数」或「参数值」阶段调用 getStaticValues，命中则直接展示。
 */

export interface ValueSuggestion {
  /** 补全插入文本 */
  insertText: string
  /** 说明 */
  desc: string
}

/**
 * 静态值表。
 *
 * key 规则：优先用「命令链前两段」（如 'git config'），其次用「根命令」（如 'chmod'）。
 * value：该位置参数/参数值的高频取值列表。
 */
export const STATIC_VALUES: Record<string, ValueSuggestion[]> = {
  // chmod 权限模式
  chmod: [
    { insertText: '755', desc: 'rwxr-xr-x · 目录/脚本常用' },
    { insertText: '644', desc: 'rw-r--r-- · 普通文件常用' },
    { insertText: '600', desc: 'rw------- · 私密文件' },
    { insertText: '700', desc: 'rwx------ · 私密目录' },
    { insertText: '640', desc: 'rw-r----- · 组可读' },
    { insertText: '775', desc: 'rwxrwxr-x · 组可写目录' },
    { insertText: '664', desc: 'rw-rw-r-- · 组可写文件' },
    { insertText: '777', desc: 'rwxrwxrwx · 全开放（慎用）' },
    { insertText: '+x', desc: '追加可执行权限' },
    { insertText: 'u+x', desc: '所有者追加可执行' },
    { insertText: 'g+w', desc: '组追加写权限' },
    { insertText: 'o-r', desc: '其他移除读权限' },
    { insertText: 'a+r', desc: '所有人追加读权限' },
    { insertText: 'a-w', desc: '所有人移除写权限' },
  ],
  // umask 掩码
  umask: [
    { insertText: '022', desc: '默认：文件 644 / 目录 755' },
    { insertText: '077', desc: '私密：文件 600 / 目录 700' },
    { insertText: '002', desc: '组共享：文件 664 / 目录 775' },
    { insertText: '007', desc: '组私密：文件 660 / 目录 770' },
  ],
}

/**
 * 参数值快捷补全（针对 --since/--until 这类「时间参数」的值）。
 *
 * key 规则：`命令链 参数名`，如 'docker logs --since'、'journalctl --until'。
 * value：该时间参数的快捷取值（无需用户手敲精确时间戳）。
 */
export const PARAM_STATIC_VALUES: Record<string, ValueSuggestion[]> = {
  // docker logs 的 --since/--until：Go duration 语法（h/m/s，不支持 d）
  'docker logs --since': [
    { insertText: '1h', desc: '最近 1 小时' },
    { insertText: '6h', desc: '最近 6 小时' },
    { insertText: '12h', desc: '最近 12 小时' },
    { insertText: '24h', desc: '最近 24 小时' },
    { insertText: '72h', desc: '最近 3 天' },
    { insertText: '168h', desc: '最近 7 天' },
  ],
  'docker logs --until': [
    { insertText: '1h', desc: '截至 1 小时前' },
    { insertText: '24h', desc: '截至 24 小时前' },
    { insertText: '72h', desc: '截至 3 天前' },
    { insertText: '168h', desc: '截至 7 天前' },
  ],
  // journalctl 的 --since/--until：systemd time 语法（today/yesterday/相对时间）
  'journalctl --since': [
    { insertText: 'today', desc: '今天 00:00 起' },
    { insertText: 'yesterday', desc: '昨天 00:00 起' },
    { insertText: '-1h', desc: '最近 1 小时' },
    { insertText: '-24h', desc: '最近 24 小时' },
    { insertText: '-7d', desc: '最近 7 天' },
    { insertText: '-30d', desc: '最近 30 天' },
  ],
  'journalctl --until': [
    { insertText: 'today', desc: '截至今天 00:00' },
    { insertText: 'yesterday', desc: '截至昨天 00:00' },
    { insertText: '-24h', desc: '截至 24 小时前' },
    { insertText: '-7d', desc: '截至 7 天前' },
  ],
  // kill -s 的信号名（kill -s TERM <pid>）
  'kill -s': [
    { insertText: 'TERM', desc: 'SIGTERM · 优雅终止（默认）' },
    { insertText: 'KILL', desc: 'SIGKILL · 强制终止' },
    { insertText: 'HUP', desc: 'SIGHUP · 重载配置' },
    { insertText: 'INT', desc: 'SIGINT · 中断（Ctrl+C）' },
    { insertText: 'QUIT', desc: 'SIGQUIT · 退出并核心转储' },
    { insertText: 'USR1', desc: 'SIGUSR1 · 用户自定义（如 nginx 重开日志）' },
    { insertText: 'USR2', desc: 'SIGUSR2 · 用户自定义（如 nginx 平滑重启）' },
    { insertText: 'STOP', desc: 'SIGSTOP · 暂停进程' },
    { insertText: 'CONT', desc: 'SIGCONT · 恢复进程' },
  ],
}

/**
 * 取「参数值阶段」的静态快捷值（如 --since 的快捷时间）。
 *
 * 判定：当前输入的前一个 token 是已知时间参数（如 --since / --until）。
 *
 * @param chainNames 命令链（如 ['docker','logs']）
 * @param tokens 完整输入 tokens（含尾部空串，用于取「上一个 token」）
 * @param currentToken 当前正在输入的 token（用于前缀过滤，空串则返回全部）
 */
export function getParamStaticValues(
  chainNames: string[],
  tokens: string[],
  currentToken: string,
): ValueSuggestion[] | null {
  if (tokens.length < 3) return null
  const prev = tokens[tokens.length - 2]
  if (!prev || !prev.startsWith('-')) return null
  const key = `${chainNames.join(' ')} ${prev}`
  const vals = PARAM_STATIC_VALUES[key]
  if (!vals) return null
  const lower = currentToken.toLowerCase()
  return lower
    ? vals.filter((v) => v.insertText.toLowerCase().startsWith(lower))
    : vals
}

/**
 * 取命令链对应的静态值补全。
 *
 * @param cmdChain 命令链（如 ['chmod'] 或 ['git','config']）
 * @returns 取值列表或 null
 */
export function getStaticValues(cmdChain: string[]): ValueSuggestion[] | null {
  if (cmdChain.length === 0) return null
  // 优先匹配「根命令 + 子命令」
  if (cmdChain.length >= 2) {
    const key2 = `${cmdChain[0]} ${cmdChain[1]}`
    if (STATIC_VALUES[key2]) return STATIC_VALUES[key2]
  }
  // 回退到根命令
  if (STATIC_VALUES[cmdChain[0]]) return STATIC_VALUES[cmdChain[0]]
  return null
}
