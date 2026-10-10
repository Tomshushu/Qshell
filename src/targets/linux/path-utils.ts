/**
 * Linux 路径工具函数
 *
 * Linux 专用的路径处理逻辑，与 Windows 完全隔离。
 */

/**
 * Linux 默认根路径
 */
export const LINUX_ROOT_PATH = '/'

/**
 * 校验路径是否为合法的 Linux 绝对路径
 */
export function isLinuxAbsolutePath(path: string): boolean {
  return path.startsWith('/')
}

/**
 * 校验上次访问路径是否与当前 targetType 兼容
 * Linux: 必须以 / 开头
 */
export function isPathCompatible(path: string): boolean {
  if (!path || path === '/') return false
  return path.startsWith('/')
}

/**
 * 获取 Linux 默认 home 目录
 */
export function getDefaultHomeDir(): string {
  return '/'
}

/**
 * 规范化 Linux 路径（确保以 / 开头）
 */
export function normalizePath(path: string): string {
  if (!path) return '/'
  if (!path.startsWith('/')) return '/' + path
  return path
}

/**
 * 拼接 Linux 路径
 */
export function joinPath(base: string, name: string): string {
  const baseTrimmed = base.trimEnd().replace(/\/+$/, '')
  if (!baseTrimmed) return '/' + name
  return baseTrimmed + '/' + name
}
