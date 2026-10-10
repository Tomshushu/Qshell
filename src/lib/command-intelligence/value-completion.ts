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
