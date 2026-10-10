/**
 * 预置终端背景资源管理。
 *
 * 预置背景打包在应用内（src-tauri/resources/desk_bg_images/），
 * 用户在主题设置中可直接点选，无需本地上传。
 * 与本地上传的背景共存，本地上传仍保留 10MB 限制。
 *
 * 添加新预置背景的步骤：
 * 1. 将文件放入 src-tauri/resources/desk_bg_images/ 目录
 * 2. 在下方 PRESET_BACKGROUNDS 数组中添加一项
 * 3. 在 i18n 的 zh-CN.ts / en.ts 中添加对应的 nameKey
 *
 * 资源访问方式：
 * - dev 模式：resourceDir() 指向 target/debug/，resources 已复制到其下的 desk_bg_images/
 * - prod 模式：resourceDir() 指向应用安装目录，desk_bg_images/ 在其下
 * - 通过 convertFileSrc 转为 asset:// URL，由 webview 直接加载
 */

import { resourceDir, join } from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'

/** 预置背景类型 */
export type PresetBackgroundType = 'image' | 'video'

/** 预置背景元数据 */
export interface PresetBackground {
  /** 唯一标识 */
  id: string
  /** 文件名（需与 desk_bg_images/ 目录下实际文件名一致） */
  filename: string
  /** 媒体类型 */
  type: PresetBackgroundType
  /** 显示名称的 i18n key（在 zh-CN.ts / en.ts 中定义） */
  nameKey: string
}

/**
 * 预置背景列表。
 *
 * 文件位于 src-tauri/resources/desk_bg_images/，
 * 打包后复制到应用安装目录的 desk_bg_images/ 下。
 */
export const PRESET_BACKGROUNDS: PresetBackground[] = [
  { id: 'preset-1', filename: '1.webp', type: 'image', nameKey: 'thm_bg_preset_1' },
  { id: 'preset-2', filename: '2.webp', type: 'image', nameKey: 'thm_bg_preset_2' },
  { id: 'preset-3', filename: '3.webp', type: 'image', nameKey: 'thm_bg_preset_3' },
  { id: 'preset-4', filename: '4.webp', type: 'image', nameKey: 'thm_bg_preset_4' },
  { id: 'preset-5', filename: '5.webp', type: 'image', nameKey: 'thm_bg_preset_5' },
  { id: 'preset-6', filename: '6.webp', type: 'image', nameKey: 'thm_bg_preset_6' },
  { id: 'preset-7', filename: '7.webp', type: 'image', nameKey: 'thm_bg_preset_7' },
  { id: 'preset-8', filename: '8.webp', type: 'image', nameKey: 'thm_bg_preset_8' },
  { id: 'preset-9', filename: '9.webp', type: 'image', nameKey: 'thm_bg_preset_9' },
]

/** resourceDir 缓存（避免每次获取预置背景 URL 都调用 Tauri 命令） */
let resourceDirCache: string | null = null

/** 路径缓存：id → 原始文件路径，避免重复拼接 */
const pathCache = new Map<string, string>()

/** URL 缓存：id → asset URL，避免重复拼接 */
const urlCache = new Map<string, string>()

/** 判断是否为 Tauri 环境 */
function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  )
}

/**
 * 获取预置背景文件的原始绝对路径。
 *
 * 用于 videoPath 字段存储（终端渲染时通过 getVideoSrc = convertFileSrc 加载）。
 * 内部缓存 resourceDir 和拼接结果，多次调用零开销。
 * 非 Tauri 环境返回空字符串。
 */
export async function getPresetBackgroundPath(preset: PresetBackground): Promise<string> {
  if (!isTauri()) return ''

  const cached = pathCache.get(preset.id)
  if (cached) return cached

  if (!resourceDirCache) {
    resourceDirCache = await resourceDir()
  }

  // resources 配置 target 为 "desk_bg_images/"，文件在 resourceDir/desk_bg_images/ 下
  const filePath = await join(resourceDirCache, 'desk_bg_images', preset.filename)
  pathCache.set(preset.id, filePath)
  return filePath
}

/**
 * 获取预置背景的 asset URL（可在 <img src> / <video src> 中直接使用）。
 *
 * 内部缓存 resourceDir 和拼接结果，多次调用零开销。
 * 非 Tauri 环境返回空字符串。
 *
 * @param preset 预置背景元数据
 * @returns asset:// URL 或空字符串
 */
export async function getPresetBackgroundUrl(preset: PresetBackground): Promise<string> {
  if (!isTauri()) return ''

  // 命中 URL 缓存
  const cached = urlCache.get(preset.id)
  if (cached) return cached

  const filePath = await getPresetBackgroundPath(preset)
  const url = convertFileSrc(filePath)
  urlCache.set(preset.id, url)
  return url
}

/**
 * 批量获取所有预置背景的 URL（用于初始化预览缩略图）。
 * @returns Map<presetId, assetUrl>
 */
export async function getAllPresetBackgroundUrls(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    PRESET_BACKGROUNDS.map(async (preset) => {
      const url = await getPresetBackgroundUrl(preset)
      map.set(preset.id, url)
    }),
  )
  return map
}
