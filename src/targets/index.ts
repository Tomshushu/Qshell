/**
 * 按连接目标类型组织的平台模块入口
 *
 * Linux 和 Windows 的路径处理逻辑完全隔离，
 * 通过 targetType 选择对应的工具函数。
 */

import { pathUtils as linux } from './linux'
import { pathUtils as windows } from './windows'

export { linux, windows }

/**
 * 根据 targetType 获取对应的路径工具
 */
export function getPathUtils(targetType: string) {
  if (targetType === 'windows') {
    return windows
  }
  return linux
}
