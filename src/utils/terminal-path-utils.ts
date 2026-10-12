/**
 * src/utils/terminal-path-utils.ts
 *
 * 终端路径解析与关联工具：
 * 1. 从 Shell 窗口标题 (OSC 0 / OSC 2) 中精准提取当前工作目录路径；
 * 2. 处理终端 `cd` 相对与绝对路径拼接规范化；
 * 3. 兼容常见 Linux/Unix 发行版（Ubuntu, Debian, CentOS, RHEL, Arch, macOS 等）的默认 PS1 标题输出。
 */

/**
 * 校验路径是否为合法的绝对路径（Linux/Unix 绝对路径或 Windows 盘符路径）
 */
export function isAbsolutePath(path?: string | null): boolean {
  if (!path) return false
  const trimmed = path.trim()
  return trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)
}

/**
 * 规范化相对路径解析
 * @param base 当前基准绝对路径（如 /var/log）
 * @param relative 相对路径或目标路径（如 nginx, .., ../../etc, /tmp）
 */
export function resolveRelativePath(base: string, relative: string): string {
  if (!relative || relative === '.') return base
  const trimmed = relative.trim()
  // 如果本身就是绝对路径，直接返回
  if (isAbsolutePath(trimmed)) {
    return trimmed.replace(/\\/g, '/')
  }

  const isWindows = /^[a-zA-Z]:[\\/]/.test(base)
  const normalizedBase = base.replace(/\\/g, '/')
  const baseParts = normalizedBase.split('/').filter(Boolean)
  const relParts = trimmed.replace(/\\/g, '/').split('/').filter(Boolean)

  for (const part of relParts) {
    if (part === '.') continue
    if (part === '..') {
      if (baseParts.length > 0) {
        baseParts.pop()
      }
    } else {
      baseParts.push(part)
    }
  }

  if (isWindows) {
    const driveMatch = base.match(/^([a-zA-Z]:)/)
    const drive = driveMatch ? driveMatch[1] : 'C:'
    return `${drive}\\${baseParts.slice(1).join('\\')}`
  }

  return '/' + baseParts.join('/')
}

/**
 * 清理路径末尾由 prompt 格式附带的标点符号（如 `]`、`$`、`#`、`>` 等）
 */
function cleanPathTrailingPunctuation(rawPath: string): string {
  return rawPath.replace(/[\]\)\$#>]+$/, '').trim()
}

/**
 * 从 Shell 窗口标题 (OSC 0 / OSC 2 / xterm title) 提取当前工作目录
 *
 * 常见 Linux 提示符标题示例：
 * - `ubuntu@ip-172-31-0-1: /var/log/nginx`
 * - `root@server:/etc/nginx`
 * - `user@host: ~/projects/qshell`
 * - `user@host: ~`
 * - `[root@prod /data/mysql]`
 * - `/var/log/syslog`
 * - `Ming: /usr/local/bin`
 *
 * @param title 终端标题字符串
 * @param homeDir 用户主目录（用于将 ~ 展开为绝对路径，如 /home/user）
 */
export function extractPathFromShellTitle(title?: string | null, homeDir = ''): string | null {
  if (!title) return null
  const trimmed = title.trim()
  if (!trimmed) return null

  const cleanHome = homeDir ? homeDir.replace(/\/+$/, '') : ''

  // 1. 优先匹配中括号括起的路径，如 `[root@prod /data/mysql]` 或 `[ubuntu@box: /opt/app]$`
  const bracketMatch = trimmed.match(
    /\[(?:[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+[:\s]+|[a-zA-Z0-9_.-]+[:\s]+)?((?:~|\/)[^\]]+)\]/
  )
  if (bracketMatch && bracketMatch[1]) {
    let p = cleanPathTrailingPunctuation(bracketMatch[1])
    if (p.startsWith('~')) {
      if (cleanHome) {
        p = p.replace(/^~/, cleanHome)
      } else {
        return null
      }
    }
    if (isAbsolutePath(p)) {
      return p
    }
  }

  // 2. 匹配典型的 `user@host: path` 或 `hostname: path` 模式
  // 例如: `ubuntu@server: /var/log`, `root@node1:/etc/nginx`, `user@host: ~/app`
  const userHostMatch = trimmed.match(
    /(?:^|[\[\s])(?:[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+)\s*[:]\s*(~(?:\/[^\s;]*)?|\/[^\s;]*)/
  )
  if (userHostMatch && userHostMatch[1]) {
    let p = cleanPathTrailingPunctuation(userHostMatch[1])
    if (p.startsWith('~')) {
      if (cleanHome) {
        p = p.replace(/^~/, cleanHome)
      } else {
        return null // 未知 home 时避免返回未展开的 ~
      }
    }
    if (isAbsolutePath(p)) {
      return p
    }
  }

  // 3. 匹配标题直接以绝对路径开头的情况，如 `/var/log/nginx` 或 `/home/user/app`
  const directPathMatch = trimmed.match(/^(\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\/?)/)
  if (directPathMatch && directPathMatch[1]) {
    return cleanPathTrailingPunctuation(directPathMatch[1])
  }

  // 4. 匹配以 ~ 开头的独立路径，如 `~/projects/web`
  const tildeMatch = trimmed.match(/^(~(?:\/[a-zA-Z0-9_.-]+)*\/?)/)
  if (tildeMatch && tildeMatch[1]) {
    if (cleanHome) {
      return cleanPathTrailingPunctuation(tildeMatch[1].replace(/^~/, cleanHome))
    }
  }

  return null
}
