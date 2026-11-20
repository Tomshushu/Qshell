import { appDataDir, join } from '@tauri-apps/api/path'
import { exists, mkdir } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/services/api'

export const DEFAULT_RECORDINGS_SUBDIR = 'recordings'
export const DEFAULT_EXPORTS_SUBDIR = 'exports'

/**
 * 解析应用数据目录下的子目录（基于 Tauri `appDataDir()` + `join()`，自动适配 Windows / macOS / Linux 路径格式）。
 * 非 Tauri 环境返回空字符串。
 */
export async function resolveAppDataSubdir(
  subdir: string,
  ensureExists = true,
): Promise<string> {
  if (!isTauri) return ''
  const base = await appDataDir()
  const target = await join(base, subdir)
  if (ensureExists && !(await exists(target))) {
    await mkdir(target, { recursive: true })
  }
  return target
}

/**
 * 解析终端录制/日志保存目录：
 * - 若用户或服务器配置了非空目录，则优先使用该目录；
 * - 否则默认落盘到 `<appDataDir>/recordings`。
 */
export async function resolveRecordingDirectory(
  configuredDir?: string | null,
  ensureExists = true,
): Promise<string> {
  const trimmed = configuredDir?.trim()
  if (trimmed) {
    if (ensureExists && isTauri) {
      try {
        if (!(await exists(trimmed))) {
          await mkdir(trimmed, { recursive: true })
        }
      } catch {
        // 自定义路径可能无权限提前创建，交由实际写入阶段报错处理
      }
    }
    return trimmed
  }
  return resolveAppDataSubdir(DEFAULT_RECORDINGS_SUBDIR, ensureExists)
}

/**
 * 构造位于默认目录（或用户指定目录）下的跨平台默认保存路径。
 */
export async function buildDefaultSavePath(
  fileName: string,
  options?: {
    preferredDir?: string | null
    fallbackSubdir?: string
    ensureExists?: boolean
  },
): Promise<string> {
  const ensureExists = options?.ensureExists ?? true
  const trimmedDir = options?.preferredDir?.trim()
  const dir = trimmedDir
    ? await resolveRecordingDirectory(trimmedDir, ensureExists)
    : await resolveAppDataSubdir(
        options?.fallbackSubdir ?? DEFAULT_EXPORTS_SUBDIR,
        ensureExists,
      )
  if (!dir) return fileName
  return join(dir, fileName)
}
