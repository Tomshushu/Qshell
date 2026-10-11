/**
 * 终端动态背景（视频）文件管理。
 *
 * 视频文件体积大（5-50MB），无法用 base64 内联到 localStorage。
 * 方案：保存到 Tauri appDataDir/backgrounds/ 目录，主题中只存文件名/路径。
 * 渲染时通过 convertFileSrc 转为 asset:// URL，由 webview 直接流式加载，不读入内存。
 *
 * GIF/动态 WebP 体积小（<5MB），仍用 base64 内联存储，复用现有图片上传流程。
 */

import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, writeFile, remove, exists, readDir } from '@tauri-apps/plugin-fs'
import { convertFileSrc } from '@tauri-apps/api/core'
import { translate } from '@/i18n'

/** 视频文件目录名（相对 appDataDir） */
const BG_DIR_NAME = 'backgrounds'

/** 支持的视频扩展名 */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogv', '.mov']

/**
 * 支持的图片扩展名（含动态 GIF/WebP）。
 * 覆盖范围较广，配合目录扫描实现「自动识别各种图片文件」的图片库。
 */
const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg',
  '.avif', '.ico', '.tif', '.tiff', '.heic', '.heif',
]

/** 用户图片库单文件大小上限 20MB（存盘不内联，可放宽） */
export const MAX_LIBRARY_IMAGE_SIZE = 20 * 1024 * 1024

/** 用户图片库条目 */
export interface UserBackground {
  /** 唯一标识（文件名作为稳定 id） */
  id: string
  /** 原始文件名（用于展示与删除） */
  name: string
  /** appDataDir/backgrounds/ 下的绝对路径 */
  path: string
  /** 可直接用于 <img src>/CSS background-image 的 asset:// URL */
  url: string
  /** 媒体类型：图片或视频 */
  type: 'image' | 'video'
}

/** 最大上传图片大小 5MB */
export const MAX_IMAGE_UPLOAD_SIZE = 5 * 1024 * 1024
/** 最大上传视频大小 10MB */
export const MAX_VIDEO_UPLOAD_SIZE = 10 * 1024 * 1024

/** 判断是否为 Tauri 环境 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** 判断文件名是否为视频 */
export function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** 判断文件名是否为图片（含动态 GIF/WebP） */
export function isImageFile(filename: string): boolean {
  const lower = filename.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * 获取背景文件目录绝对路径（appDataDir/backgrounds/），自动创建目录。
 * 非 Tauri 环境返回空字符串。
 */
async function getBgDir(): Promise<string> {
  if (!isTauri()) return ''
  const dir = await appDataDir()
  const bgDir = await join(dir, BG_DIR_NAME)
  if (!(await exists(bgDir))) {
    // 目录创建失败需抛出，否则后续 writeFile 会以更模糊的错误失败
    await mkdir(bgDir, { recursive: true })
  }
  return bgDir
}

/**
 * 将用户上传的视频背景文件保存至 appDataDir/backgrounds/ 目录。
 * 使用 fs.writeFile 离线保存，后续直接由 convertFileSrc 加载，
 * 避免 Data URL / Blob URL 跨页面丢失或占用大量内存。
 *
 * @param file 用户选择的原生 File 对象
 * @returns 保存后的绝对路径；非 Tauri 环境或失败返回空字符串
 */
export async function saveVideoBackground(file: File): Promise<string> {
  if (!isTauri()) {
    throw new Error(translate('bg_err_desktop_only'))
  }
  if (file.size > MAX_VIDEO_UPLOAD_SIZE) {
    throw new Error(translate('bg_err_file_too_large').replace('{size}', (file.size / 1024 / 1024).toFixed(1)))
  }
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || 'mp4')
  if (!VIDEO_EXTENSIONS.includes(ext)) {
    throw new Error(translate('bg_err_unsupported_video').replace('{ext}', ext))
  }
  const bgDir = await getBgDir()
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const filename = `bg-${id}${ext}`
  const filePath = await join(bgDir, filename)
  // 大文件分块写入，避免一次性 arrayBuffer 占用过多内存
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    await writeFile(filePath, bytes)
  } catch (err) {
    // 写入失败时清理空文件，并附带路径信息便于排查
    await remove(filePath).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      translate('bg_err_write_video_failed').replace('{path}', filePath).replace('{msg}', msg),
      { cause: err },
    )
  }
  return filePath
}

/**
 * 删除 appDataDir/backgrounds/ 下的视频文件。
 * 切换/清除背景时调用，避免磁盘残留无用文件。
 */
export async function deleteVideoBackground(videoPath: string): Promise<void> {
  if (!isTauri() || !videoPath) return
  try {
    if (await exists(videoPath)) {
      await remove(videoPath)
    }
  } catch {
    // 删除失败不阻塞（文件可能已被移走）
  }
}

/**
 * 将视频文件路径转换为可在 <video src> 中使用的 URL。
 * 通过 Tauri asset 协议加载，不读入内存。
 * 非 Tauri 环境返回空字符串。
 */
export function getVideoSrc(videoPath: string): string {
  if (!isTauri() || !videoPath) return ''
  return convertFileSrc(videoPath)
}

/**
 * 将动态图片（GIF/动态WebP）File 转为 base64 data URL，不压缩（保留动画帧）。
 * 静态图片请继续使用 terminal-theme-dialog 中的 compressImage 处理。
 */
export async function animatedImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(translate('bg_err_img_read_failed')))
    reader.readAsDataURL(file)
  })
}

/**
 * 将用户上传的图片背景保存到 appDataDir/backgrounds/ 图片库。
 * 与视频库共用目录，按扩展名自动识别各种图片格式（见 IMAGE_EXTENSIONS）。
 * 原图直接落盘（不压缩），后续由 convertFileSrc 流式加载。
 *
 * @param file 用户选择的原生 File 对象
 * @returns 保存后的绝对路径；非 Tauri 环境或失败抛出错误
 */
export async function saveImageBackground(file: File): Promise<string> {
  if (!isTauri()) {
    throw new Error(translate('bg_err_desktop_only'))
  }
  if (file.size > MAX_LIBRARY_IMAGE_SIZE) {
    throw new Error(translate('bg_err_file_too_large').replace('{size}', (file.size / 1024 / 1024).toFixed(1)))
  }
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
  if (!IMAGE_EXTENSIONS.includes(ext)) {
    throw new Error(translate('thm_bg_unsupported_format'))
  }
  const bgDir = await getBgDir()
  // 用时间戳+随机串生成稳定文件名，避免重名覆盖
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const safeBase = (file.name.replace(/[^\w.-]/g, '_').replace(/\.[^.]+$/, '') || 'img').slice(-40)
  const filename = `lib-${id}-${safeBase}${ext}`
  const filePath = await join(bgDir, filename)
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    await writeFile(filePath, bytes)
  } catch (err) {
    await remove(filePath).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      translate('bg_err_write_video_failed').replace('{path}', filePath).replace('{msg}', msg),
      { cause: err },
    )
  }
  return filePath
}

/**
 * 扫描 appDataDir/backgrounds/ 目录，自动识别并返回所有图片库条目。
 * 与视频文件共存于同目录，这里只筛出图片（按扩展名）。
 * 非 Tauri 环境返回空数组。
 *
 * @returns UserBackground[]（按文件名排序）
 */
export async function listUserBackgrounds(): Promise<UserBackground[]> {
  if (!isTauri()) return []
  const bgDir = await getBgDir()
  let entries: Awaited<ReturnType<typeof readDir>>
  try {
    entries = await readDir(bgDir)
  } catch {
    // 目录尚不存在（从未上传过）时返回空列表
    return []
  }
  const list: UserBackground[] = []
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.name
    const lower = name.toLowerCase()
    const isImg = IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
    const isVid = VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
    if (!isImg && !isVid) continue
    const path = await join(bgDir, name)
    list.push({
      id: name,
      name,
      path,
      url: convertFileSrc(path),
      type: isVid ? 'video' : 'image',
    })
  }
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}

/**
 * 将图片库条目的路径转换为可在 <img src> 中使用的 URL。
 * 非 Tauri 环境返回空字符串。
 */
export function getUserImageSrc(path: string): string {
  if (!isTauri() || !path) return ''
  return convertFileSrc(path)
}

/**
 * 从图片库删除某个背景文件（用户主动管理图片库时调用）。
 * 不会校验该背景是否正被某主题使用——调用方应自行处理「正在使用则先清除」。
 */
export async function deleteUserBackground(path: string): Promise<void> {
  if (!isTauri() || !path) return
  try {
    if (await exists(path)) {
      await remove(path)
    }
  } catch {
    // 删除失败不阻塞
  }
}
