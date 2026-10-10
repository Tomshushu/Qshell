/**
 * Windows 路径工具函数
 *
 * Windows 专用的路径处理逻辑，与 Linux 完全隔离。
 */

/**
 * Windows 默认根路径
 */
export const WINDOWS_ROOT_PATH = 'C:\\'

/**
 * 校验路径是否为合法的 Windows 绝对路径
 */
export function isWindowsAbsolutePath(path: string): boolean {
  if (path.length >= 3 && /^[A-Za-z]:[\\/]/.test(path)) return true
  if (path.startsWith('\\\\')) return true
  return false
}

/**
 * 校验上次访问路径是否与当前 targetType 兼容
 * Windows: 必须是盘符路径（X:\）或 UNC 路径（\\）
 */
export function isPathCompatible(path: string): boolean {
  if (!path || path === '/') return false
  return isWindowsAbsolutePath(path)
}

/**
 * 获取 Windows 默认 home 目录
 */
export function getDefaultHomeDir(): string {
  return 'C:\\'
}

/**
 * 校验 homeDir 是否为 Windows 路径格式
 * 如果返回了 POSIX 路径（如 /），需要用 C:\ 兜底
 */
export function isWindowsPath(path: string): boolean {
  return path.includes(':') || path.startsWith('\\\\')
}

/**
 * 规范化 Windows 路径
 */
export function normalizePath(path: string): string {
  if (!path) return 'C:\\'
  return path
}

/**
 * 拼接 Windows 路径
 */
export function joinPath(base: string, name: string): string {
  const baseTrimmed = base.trimEnd().replace(/[\\/]+$/, '')
  if (!baseTrimmed) return name
  return baseTrimmed + '\\' + name
}
