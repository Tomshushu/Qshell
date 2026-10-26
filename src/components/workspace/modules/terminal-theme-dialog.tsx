import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { SelectPopover } from '@/components/ui/select-popover'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import {
  PRESET_TERMINAL_THEMES,
  getTerminalTheme,
  validateTerminalTheme,
  type TerminalTheme,
  type TerminalThemeOverride,
} from '@/utils/terminal-themes'
import type { HighlightRule } from '@/utils/terminal-highlighter'
import { useToast } from '@/components/ui/toast'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { Plus, Trash2, Copy, Check, Info, AlertTriangle, Download, Upload, Monitor, Loader2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TerminalThemePreview } from './terminal-theme-preview'
import { isTauri } from '@/services/api'
// 导入/导出优先使用 Tauri 原生 dialog + fs 插件（Windows/macOS/Linux 三平台
// 均弹出系统原生文件对话框，用户明确知道保存/选择路径）。
// 非 Tauri 环境（如纯浏览器调试）回退到浏览器方案。
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
import {
  isVideoFile,
  saveVideoBackground,
  deleteVideoBackground,
  getVideoSrc,
  getUserImageSrc,
  saveImageBackground,
  listUserBackgrounds,
  deleteUserBackground,
  type UserBackground,
} from '@/lib/terminal-background'
import {
  PRESET_BACKGROUNDS,
  getPresetBackgroundUrl,
  getPresetBackgroundPath,
  type PresetBackground,
} from '@/lib/preset-backgrounds'

interface TerminalThemeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 从任意 CSS 颜色字符串中解析出 6 位 Hex 颜色（用于 input[type="color"] 的 value）
 */
function colorToHex6(colorStr: string): string {
  if (!colorStr) return '#808080'
  const str = colorStr.trim()

  // 1. rgba(r, g, b, a) 或 rgb(r, g, b)
  const rgbMatch = str.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1], 10))
    const g = Math.min(255, parseInt(rgbMatch[2], 10))
    const b = Math.min(255, parseInt(rgbMatch[3], 10))
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }

  // 2. Hex 颜色
  if (str.startsWith('#')) {
    const hex = str.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      // #rgb 或 #rgba
      return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    }
    if (hex.length >= 6) {
      // #rrggbb 或 #rrggbbaa
      return `#${hex.slice(0, 6)}`
    }
  }

  return '#808080'
}

export function TerminalThemeDialog({ open, onOpenChange }: TerminalThemeDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const {
    terminalThemeId,
    setTerminalThemeId,
    customTerminalThemes,
    addCustomTerminalTheme,
    deleteCustomTerminalTheme,
    updateCustomTerminalTheme,
    importCustomTerminalThemes,
    terminalThemeOverrides,
    setTerminalThemeOverride,
    clearTerminalThemeOverride,
    terminalHighlightEnabled,
    setTerminalHighlightEnabled,
    terminalHighlightRules,
    addHighlightRule,
    deleteHighlightRule,
    updateHighlightRule,
  } = useAppStore()

  // 选中的编辑/预览主题 ID
  const [selectedThemeId, setSelectedThemeId] = useState(terminalThemeId)
  // 左侧列表过滤：all=全部, custom=仅自定义
  const [listFilter, setListFilter] = useState<'all' | 'custom'>('all')

  // 打开弹框时同步选中项到当前应用的主题，避免外部切换主题后弹框仍停留在旧选中。
  const sessionKey = open ? `open:${terminalThemeId}` : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) setSelectedThemeId(useAppStore.getState().terminalThemeId)
  }

  // 临时编辑状态，避免高频渲染卡顿
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<'dark' | 'light'>('dark')
  const [editBackground, setEditBackground] = useState('#181824')
  const [editForeground, setEditForeground] = useState('#b2b2b2')
  const [editCursor, setEditCursor] = useState('#00ff88')
  const [editCursorForeground, setEditCursorForeground] = useState('#181824')
  const [editSelection, setEditSelection] = useState('rgba(255, 255, 255, 0.15)')
  const [editSelectionForeground, setEditSelectionForeground] = useState('#ffffff')
  const [editActiveBorder, setEditActiveBorder] = useState('#38bdf8')
  const [editAnsiColors, setEditAnsiColors] = useState<Record<string, string>>({})

  // 背景图编辑状态（仅自定义主题可用）
  const [editBgImage, setEditBgImage] = useState<string | undefined>(undefined)
  const [editBgVideoPath, setEditBgVideoPath] = useState<string | undefined>(undefined)
  const [editBgType, setEditBgType] = useState<'image' | 'video' | undefined>(undefined)
  const [editBgOpacity, setEditBgOpacity] = useState<number>(1)
  const [editBgBlur, setEditBgBlur] = useState<number>(0)
  const [editBgSize, setEditBgSize] = useState<'cover' | 'contain' | 'center'>('cover')
  // 是否有任意背景媒体（图片 base64 或视频路径）
  const hasBgMedia = !!(editBgImage || editBgVideoPath)
  // 预置背景缩略图 URL 列表（对话框打开时加载，避免重复调用 resourceDir）
  const [presetBgUrls, setPresetBgUrls] = useState<Map<string, string>>(new Map())
  // 用户图片库（动态扫描 appDataDir/backgrounds/，自动识别图片文件）
  const [userBgList, setUserBgList] = useState<UserBackground[]>([])
  const [userBgLoading, setUserBgLoading] = useState(false)
  // 图片库上传输入 ref（仅图片，可多选）
  const libImageInputRef = useRef<HTMLInputElement>(null)

  // 合并预设主题与自定义主题。
  // 预设主题本身是完整的新格式，无需迁移；自定义主题可能是旧版本持久化的扁平结构，
  // 需经过 getTerminalTheme 做字段补全（补 ui 对象、cursorForeground 等），否则
  // TerminalThemePreview 访问 theme.ui.background 会崩溃。
  // 自定义主题 ID 不可能与预设冲突（import 会去重，新建用 UUID），所以
  // getTerminalTheme(t.id, customThemes) 会正确返回该自定义主题本身（经迁移后）。
  const allThemes = [
    ...PRESET_TERMINAL_THEMES,
    ...customTerminalThemes.map((t) => getTerminalTheme(t.id, customTerminalThemes)),
  ]
  // activeTheme 合并 overrides，使编辑区显示系统主题的覆盖层配置
  const activeTheme = getTerminalTheme(selectedThemeId, customTerminalThemes, terminalThemeOverrides)
  const isCustom = customTerminalThemes.some((t) => t.id === selectedThemeId)
  // 当前选中主题是否有非默认的背景图覆盖（用于"恢复默认"按钮显示）
  const hasOverride = !isCustom && !!terminalThemeOverrides[selectedThemeId]

  // 当选择的主题改变时，初始化编辑状态
  // 采用渲染期「props 变化时调整 state」模式，避免在 effect 内同步 setState 触发级联渲染
  const [prevThemeId, setPrevThemeId] = useState<string | null>(null)
  if (selectedThemeId !== prevThemeId) {
    setPrevThemeId(selectedThemeId)
    if (activeTheme) {
      setEditName(activeTheme.name)
      setEditType(activeTheme.type)
      setEditBackground(activeTheme.ui.background)
      setEditForeground(activeTheme.ui.foreground)
      setEditCursor(activeTheme.ui.cursor)
      setEditCursorForeground(activeTheme.ui.cursorForeground || activeTheme.ui.background)
      setEditSelection(activeTheme.ui.selection)
      setEditSelectionForeground(activeTheme.ui.selectionForeground || activeTheme.ui.foreground)
      setEditActiveBorder(activeTheme.ui.activeBorder || (activeTheme.type === 'light' ? '#0284c7' : '#38bdf8'))
      setEditAnsiColors({
        black: activeTheme.ansi.black || '#000000',
        red: activeTheme.ansi.red || '#f14c4c',
        green: activeTheme.ansi.green || '#23d18b',
        yellow: activeTheme.ansi.yellow || '#f5f543',
        blue: activeTheme.ansi.blue || '#3b8eea',
        magenta: activeTheme.ansi.magenta || '#d670d6',
        cyan: activeTheme.ansi.cyan || '#29b8db',
        white: activeTheme.ansi.white || '#e5e5e5',
        brightBlack: activeTheme.ansi.brightBlack || '#666666',
        brightRed: activeTheme.ansi.brightRed || '#f14c4c',
        brightGreen: activeTheme.ansi.brightGreen || '#23d18b',
        brightYellow: activeTheme.ansi.brightYellow || '#f5f543',
        brightBlue: activeTheme.ansi.brightBlue || '#3b8eea',
        brightMagenta: activeTheme.ansi.brightMagenta || '#d670d6',
        brightCyan: activeTheme.ansi.brightCyan || '#29b8db',
        brightWhite: activeTheme.ansi.brightWhite || '#ffffff',
      })
      // 同步背景配置（无则重置为默认值）
      setEditBgImage(activeTheme.background?.image)
      setEditBgVideoPath(activeTheme.background?.videoPath)
      setEditBgType(activeTheme.background?.type)
      setEditBgOpacity(activeTheme.background?.opacity ?? 1)
      setEditBgBlur(activeTheme.background?.blur ?? 0)
      setEditBgSize(activeTheme.background?.size ?? 'cover')
    }
  }

  // 加载预置背景缩略图 URL（组件挂载时执行一次，结果缓存到 state）
  useEffect(() => {
    if (PRESET_BACKGROUNDS.length === 0) return
    let cancelled = false
    Promise.all(
      PRESET_BACKGROUNDS.map(async (preset) => [preset.id, await getPresetBackgroundUrl(preset)] as const),
    ).then((entries) => {
      if (!cancelled) setPresetBgUrls(new Map(entries))
    }).catch(() => {
      // 预置背景加载失败不阻塞对话框使用
    })
    return () => { cancelled = true }
  }, [])

  // 导出全部自定义主题
  // 注意：customTerminalThemes 可能含旧版本持久化的扁平结构（无 ui/ansi 对象），
  // 直接序列化会导致重新导入时 validateTerminalTheme 校验失败。
  // 这里经 getTerminalTheme 迁移为完整新格式后再导出，保证导出文件可被本应用重新导入。
  // Tauri 环境用系统原生保存对话框；非 Tauri 环境回退到浏览器 Blob+<a download>。
  const handleExportAllThemes = async () => {
    if (customTerminalThemes.length === 0) return
    const migrated = customTerminalThemes.map((th) => getTerminalTheme(th.id, customTerminalThemes))
    const json = JSON.stringify(
      { $schema: 'trae-terminal-themes/v1', themes: migrated },
      null,
      2,
    )
    const defaultName = `trae-custom-themes-${new Date().toISOString().slice(0, 10)}.json`
    try {
      if (isTauri) {
        const filePath = await saveDialog({
          defaultPath: defaultName,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (!filePath) return
        await writeTextFile(filePath, json)
        toast.success(t('thm_export_saved').replace('{path}', filePath))
      } else {
        // 浏览器回退：Blob + <a download>
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = defaultName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success(t('thm_export_saved').replace('{path}', defaultName))
      }
    } catch (e) {
      toast.error(t('thm_export_failed') + (e instanceof Error ? `: ${e.message}` : ''))
    }
  }

  // 导入自定义主题：Tauri 环境用系统原生 open() 对话框 + readTextFile；
  // 非 Tauri 环境回退到 <input type=file>。
  // 系统已预置主题，导入时自动跳过与预设 id 相同的项，只导入自定义主题。
  const handleImport = async () => {
    try {
      let text: string
      if (isTauri) {
        const selected = await openDialog({
          multiple: false,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (typeof selected !== 'string' || !selected) return
        text = await readTextFile(selected)
      } else {
        // 浏览器回退：<input type=file> + FileReader
        text = await new Promise<string>((resolve, reject) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = '.json,application/json'
          input.onchange = () => {
            const file = input.files?.[0]
            if (!file) { reject(new Error('cancelled')); return }
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(reader.error)
            reader.readAsText(file)
          }
          input.click()
        })
      }

      const parsed = JSON.parse(text)
      // 支持单个主题对象或 { themes: [...] } 数组格式
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.themes)
          ? parsed.themes
          : [parsed]
      const presetIds = new Set(PRESET_TERMINAL_THEMES.map((t) => t.id))
      let fail = 0
      let skippedPreset = 0
      const valid: TerminalTheme[] = []
      for (const item of arr) {
        const v = validateTerminalTheme(item)
        if (!v) {
          fail++
          continue
        }
        // 跳过系统预设主题（id 命中预设集合）
        if (presetIds.has(v.id)) {
          skippedPreset++
          continue
        }
        valid.push(v)
      }
      if (valid.length > 0) {
        const importedThemes = importCustomTerminalThemes(valid)
        // 选中第一个导入的主题（用重命名后的真实 ID，避免 ID 冲突时选中不存在主题）
        if (importedThemes.length > 0) setSelectedThemeId(importedThemes[0].id)
        if (fail > 0) {
          toast.warning(t('thm_import_partial').replace('{n}', String(importedThemes.length)).replace('{failed}', String(fail)))
        } else {
          toast.success(t('thm_import_success').replace('{n}', String(importedThemes.length)))
        }
      } else if (skippedPreset > 0) {
        // 文件合法但全是预设主题
        toast.warning(t('thm_import_only_preset'))
      } else {
        toast.error(t('thm_import_failed'))
      }
    } catch (e) {
      // 用户取消选择（浏览器回退的 reject('cancelled')）不提示错误
      if (e instanceof Error && e.message === 'cancelled') return
      // readTextFile/JSON.parse 失败统一提示导入失败
      toast.error(t('thm_import_failed') + (e instanceof Error ? `: ${e.message}` : ''))
    }
  }

  // 新建自定义主题 (22 色模型：4 UI 基础 + 2 UI 扩展 + 16 ANSI + 1 type = 22)
  const handleCreateTheme = () => {
    const newId = `custom-theme-${crypto.randomUUID()}`
    const newTheme: TerminalTheme = {
      id: newId,
      name: t('thm_custom_n').replace('{n}', String(customTerminalThemes.length + 1)),
      type: 'dark',
      ui: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#00ff88',
        cursorForeground: '#1a1a2e',
        selection: 'rgba(255, 255, 255, 0.15)',
        selectionForeground: '#e0e0e0',
        activeBorder: '#38bdf8',
      },
      ansi: {
        black: '#000000',
        red: '#f14c4c',
        green: '#23d18b',
        yellow: '#f5f543',
        blue: '#3b8eea',
        magenta: '#d670d6',
        cyan: '#29b8db',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    }
    addCustomTerminalTheme(newTheme)
    setSelectedThemeId(newId)
    setTerminalThemeId(newId) // 自动应用
  }

  // 基于当前选中的主题克隆并自定义
  const handleCloneTheme = () => {
    if (!activeTheme) return
    const newId = `custom-theme-${crypto.randomUUID()}`
    const clonedTheme: TerminalTheme = {
      id: newId,
      name: t('thm_copy').replace('{name}', activeTheme.name),
      type: activeTheme.type,
      ui: { ...activeTheme.ui },
      ansi: { ...activeTheme.ansi },
      // 克隆时保留背景图配置（深拷贝避免引用共享）
      ...(activeTheme.background ? { background: { ...activeTheme.background } } : {}),
    }
    addCustomTerminalTheme(clonedTheme)
    setSelectedThemeId(newId)
    setTerminalThemeId(newId) // 自动应用
  }

  // 删除自定义主题
  const handleDeleteTheme = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteCustomTerminalTheme(id)
    // 删除当前选中主题后，回退到当前实际生效的主题。
    // 用 getState() 读取 store 最新值（deleteCustomTerminalTheme 已同步回退被删 ID）。
    if (selectedThemeId === id) {
      setSelectedThemeId(useAppStore.getState().terminalThemeId)
    }
  }

  // 清除背景：自定义主题删除 theme.background；系统预设主题清除整个覆盖层（恢复默认）。
  // 若是视频背景，同时删除磁盘上的视频文件避免残留。
  const handleClearBgImage = async () => {
    if (editBgVideoPath) {
      await deleteVideoBackground(editBgVideoPath).catch(() => {})
    }
    setEditBgImage(undefined)
    setEditBgVideoPath(undefined)
    setEditBgType(undefined)
    if (isCustom) {
      updateCustomTerminalTheme(selectedThemeId, { background: undefined })
    } else {
      clearTerminalThemeOverride(selectedThemeId)
    }
  }

  // 选择预置背景（打包在应用内的图片/视频，用户无需本地上传）。
  // 预置图片：image 字段存 asset:// URL（convertFileSrc 转换后的路径），与 base64 data URL 一样可直接在 CSS/IMG 中使用
  // 预置视频：videoPath 字段存 resourceDir 绝对路径，渲染时通过 getVideoSrc = convertFileSrc 加载
  // 切换前若当前是本地上传的视频，需删除磁盘文件避免残留
  const handleSelectPresetBg = async (preset: PresetBackground) => {
    try {
      const url = await getPresetBackgroundUrl(preset)
      if (!url) {
        toast.error(t('thm_bg_preset_load_failed'))
        return
      }
      // 清理旧的本地上传视频文件（预置视频在安装目录内，不可删除）
      if (editBgVideoPath) {
        await deleteVideoBackground(editBgVideoPath).catch(() => {})
      }
      const isFirstUpload = !hasBgMedia
      const newOpacity = isFirstUpload ? 0.7 : editBgOpacity

      if (preset.type === 'video') {
        // 预置视频：videoPath 存原始绝对路径，终端渲染时通过 getVideoSrc 加载
        const rawPath = await getPresetBackgroundPath(preset)
        setEditBgVideoPath(rawPath)
        setEditBgImage(undefined)
        setEditBgType('video')
        if (isFirstUpload) setEditBgOpacity(newOpacity)
        updateBgConfig({
          type: 'video',
          videoPath: rawPath,
          image: undefined,
          ...(isFirstUpload ? { opacity: newOpacity } : {}),
        })
      } else {
        // 预置图片：image 存 asset:// URL，与 base64 data URL 一样可直接在 CSS background-image 中使用
        setEditBgImage(url)
        setEditBgVideoPath(undefined)
        setEditBgType('image')
        if (isFirstUpload) setEditBgOpacity(newOpacity)
        updateBgConfig({
          type: 'image',
          image: url,
          videoPath: undefined,
          ...(isFirstUpload ? { opacity: newOpacity } : {}),
        })
      }
      toast.success(t('thm_bg_upload_success'))
    } catch (err) {
      console.error('[terminal-bg] 选择预置背景失败:', err)
      toast.error(t('thm_bg_preset_load_failed'))
    }
  }

  // 刷新用户图片库（从 appDataDir/backgrounds/ 自动识别图片文件）
  const refreshUserBgs = useCallback(async () => {
    setUserBgLoading(true)
    try {
      const list = await listUserBackgrounds()
      setUserBgList(list)
    } catch (err) {
      console.error('[terminal-bg] 加载图片库失败:', err)
      toast.error(t('thm_bg_library_load_failed'))
    } finally {
      setUserBgLoading(false)
    }
  }, [t])

  // 选择媒体库中的某张图片或视频作为当前背景
  const handleSelectUserBg = async (bg: UserBackground) => {
    try {
      if (editBgVideoPath && bg.path !== editBgVideoPath) {
        // 切走时不删除库中的视频文件
      }
      const isFirstUpload = !hasBgMedia
      const newOpacity = isFirstUpload ? 0.7 : editBgOpacity

      if (bg.type === 'video') {
        setEditBgVideoPath(bg.path)
        setEditBgImage(undefined)
        setEditBgType('video')
        if (isFirstUpload) setEditBgOpacity(newOpacity)
        updateBgConfig({
          type: 'video',
          videoPath: bg.path,
          image: undefined,
          ...(isFirstUpload ? { opacity: newOpacity } : {}),
        })
      } else {
        setEditBgImage(bg.url)
        setEditBgVideoPath(undefined)
        setEditBgType('image')
        if (isFirstUpload) setEditBgOpacity(newOpacity)
        updateBgConfig({
          type: 'image',
          image: bg.url,
          videoPath: undefined,
          ...(isFirstUpload ? { opacity: newOpacity } : {}),
        })
      }
      toast.success(t('thm_bg_upload_success'))
    } catch (err) {
      console.error('[terminal-bg] 选择图片库背景失败:', err)
      toast.error(t('thm_bg_library_load_failed'))
    }
  }

  // 上传图片或视频到媒体库（保存后入库，并自动应用为当前终端背景）
  const handleAddToLibrary = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    let added = 0
    let failed = 0
    let lastSavedPath = ''
    let lastSavedIsVideo = false

    for (const file of files) {
      try {
        const isVideo = isVideoFile(file.name)
        let savedPath = ''
        if (isVideo) {
          savedPath = await saveVideoBackground(file)
        } else {
          savedPath = await saveImageBackground(file)
        }
        if (savedPath) {
          added += 1
          lastSavedPath = savedPath
          lastSavedIsVideo = isVideo
        }
      } catch (err) {
        failed += 1
        console.error('[terminal-bg] 加入图片库失败:', err)
      }
    }
    await refreshUserBgs()
    if (added > 0) {
      toast.success(t('thm_bg_library_added').replace('{n}', String(added)))
      // 自动选中使用最新上传的媒体
      if (lastSavedPath) {
        const isFirstUpload = !hasBgMedia
        const newOpacity = isFirstUpload ? 0.7 : editBgOpacity
        if (lastSavedIsVideo) {
          setEditBgVideoPath(lastSavedPath)
          setEditBgImage(undefined)
          setEditBgType('video')
          if (isFirstUpload) setEditBgOpacity(newOpacity)
          updateBgConfig({
            type: 'video',
            videoPath: lastSavedPath,
            image: undefined,
            ...(isFirstUpload ? { opacity: newOpacity } : {}),
          })
        } else {
          const url = getUserImageSrc(lastSavedPath)
          setEditBgImage(url)
          setEditBgVideoPath(undefined)
          setEditBgType('image')
          if (isFirstUpload) setEditBgOpacity(newOpacity)
          updateBgConfig({
            type: 'image',
            image: url,
            videoPath: undefined,
            ...(isFirstUpload ? { opacity: newOpacity } : {}),
          })
        }
      }
    }
    if (failed > 0) toast.error(t('thm_bg_library_add_failed').replace('{n}', String(failed)))
    if (libImageInputRef.current) libImageInputRef.current.value = ''
  }

  // 从图片库删除某张图片（若当前正应用该项，则一并清除背景避免裂图）
  const handleDeleteUserBg = async (bg: UserBackground) => {
    await deleteUserBackground(bg.path).catch(() => {})
    if (editBgImage === bg.url || editBgVideoPath === bg.path) {
      await handleClearBgImage()
    }
    await refreshUserBgs()
  }

  // 组件挂载时加载用户图片库
  useEffect(() => {
    refreshUserBgs()
  }, [refreshUserBgs])

  // 更新背景配置项（type/image/videoPath/opacity/blur/size）。
  // 自定义主题：合并写入 theme.background；无任何媒体则删除 background。
  // 系统预设主题：写入 terminalThemeOverrides 覆盖层；无任何媒体则清除整个覆盖层（恢复默认）。
  const updateBgConfig = (patch: Partial<NonNullable<TerminalTheme['background']>>) => {
    if (isCustom) {
      const current: NonNullable<TerminalTheme['background']> = {
        type: editBgType,
        image: editBgImage,
        videoPath: editBgVideoPath,
        opacity: editBgOpacity,
        blur: editBgBlur,
        size: editBgSize,
        ...patch,
      }
      // 无任何媒体则不保存 background 配置
      if (!current.image && !current.videoPath) {
        updateCustomTerminalTheme(selectedThemeId, { background: undefined })
        return
      }
      updateCustomTerminalTheme(selectedThemeId, { background: current })
    } else {
      // 系统预设主题：写所有字段到覆盖层。
      // 注意：必须用 'field' in patch 判断字段是否被显式提供，
      // 而非 !== undefined —— 因为切换背景类型时会显式传 videoPath: undefined
      // 或 image: undefined 来清除旧值，此时 !== undefined 会漏判导致旧值残留。
      const overridePatch: TerminalThemeOverride = {}
      if ('type' in patch) overridePatch.type = patch.type
      if ('image' in patch) overridePatch.image = patch.image
      if ('videoPath' in patch) overridePatch.videoPath = patch.videoPath
      if ('opacity' in patch) overridePatch.opacity = patch.opacity
      if ('blur' in patch) overridePatch.blur = patch.blur
      if ('size' in patch) overridePatch.size = patch.size
      // 无任何媒体时清除整个覆盖层
      const futureImage = 'image' in patch ? patch.image : editBgImage
      const futureVideo = 'videoPath' in patch ? patch.videoPath : editBgVideoPath
      if (!futureImage && !futureVideo) {
        clearTerminalThemeOverride(selectedThemeId)
        return
      }
      setTerminalThemeOverride(selectedThemeId, overridePatch)
    }
  }

  // 恢复系统预设主题的背景配置到默认（清除覆盖层，含图片/视频）
  // 同时删除磁盘上的视频文件
  const handleResetBgOverride = async () => {
    const override = terminalThemeOverrides[selectedThemeId]
    if (override?.videoPath) {
      await deleteVideoBackground(override.videoPath).catch(() => {})
    }
    clearTerminalThemeOverride(selectedThemeId)
    setEditBgImage(undefined)
    setEditBgVideoPath(undefined)
    setEditBgType(undefined)
    setEditBgOpacity(1)
    setEditBgBlur(0)
    setEditBgSize('cover')
    toast.success(t('thm_bg_reset_success'))
  }

  // 新增自定义日志高亮规则
  const handleAddRule = () => {
    const newRule: HighlightRule = {
      id: `rule-${crypto.randomUUID()}`,
      name: t('thm_new_rule'),
      regex: 'pattern',
      color: '#38bdf8',
      enabled: true,
    }
    addHighlightRule(newRule)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[min(620px,calc(100vh-2rem))] flex flex-col p-6 bg-background border rounded-xl overflow-hidden gap-0">
        <DialogHeader className="pb-4 border-b">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            🎨 {t('thm_dialog_title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('thm_dialog_desc')}
          </DialogDescription>
        </DialogHeader>

        {/* 主体左右布局 */}
        <div className="flex-1 flex min-h-0">
          {/* 左侧：主题列表 */}
          <div className="w-[260px] border-r pr-4 py-4 flex flex-col gap-3 h-full">
            {/* 顶部：预设/自定义切换 + 列表标题 */}
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-muted/40 rounded-lg border border-border/50">
                <button
                  type="button"
                  onClick={() => setListFilter('all')}
                  className={`h-7 text-[11px] font-medium rounded-md transition-colors ${
                    listFilter === 'all' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('thm_list_preset')}
                </button>
                <button
                  type="button"
                  onClick={() => setListFilter('custom')}
                  className={`h-7 text-[11px] font-medium rounded-md transition-colors ${
                    listFilter === 'custom' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('thm_list_custom')}
                </button>
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-2 pr-2.5">
                {(listFilter === 'custom' ? allThemes.filter((th) => customTerminalThemes.some((c) => c.id === th.id)) : allThemes).map((theme) => {
                  const isActive = theme.id === selectedThemeId
                  const isCurrentApplied = theme.id === terminalThemeId

                  return (
                    <div
                      key={theme.id}
                      onClick={() => setSelectedThemeId(theme.id)}
                      className={`group relative flex flex-col p-2.5 rounded-lg border cursor-pointer transition-all select-none hover:bg-accent/40 ${
                        isActive
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border/60 bg-muted/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium truncate max-w-[140px]">
                          {theme.name}
                        </span>
                        {isCurrentApplied && (
                          <span className="text-[9px] bg-green-500/10 text-green-500 px-1 rounded font-medium flex items-center gap-0.5">
                            <Check className="h-2 w-2" /> {t('thm_active')}
                          </span>
                        )}
                      </div>

                      {/* 主题预览缩略图 */}
                      <TerminalThemePreview theme={theme} size="sm" />

                      {/* 操作按钮组 (仅限自定义主题) */}
                      {customTerminalThemes.some((t) => t.id === theme.id) && (
                        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 z-10">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                            onClick={(e) => handleDeleteTheme(theme.id, e)}
                            title={t('thm_delete_theme')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* 自定义过滤下无主题时的空状态 */}
                {listFilter === 'custom' && customTerminalThemes.length === 0 && (
                  <div className="text-center py-8 text-xs text-muted-foreground select-none">
                    {t('thm_no_custom_hint')}
                  </div>
                )}
              </div>
            </ScrollArea>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs w-full justify-center border-dashed"
              onClick={handleCreateTheme}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('thm_new_custom')}
            </Button>

            {/* 导入 / 导出 按钮：仅在"自定义"视图下显示。
                系统已预置主题，导入只接收自定义主题（预设 id 自动跳过）；
                导出统一导出全部自定义主题，无需逐个导出。 */}
            {listFilter === 'custom' && (
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs flex-1 justify-center"
                  onClick={handleImport}
                  title={t('thm_import')}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {t('thm_import')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs flex-1 justify-center"
                  onClick={handleExportAllThemes}
                  disabled={customTerminalThemes.length === 0}
                  title={t('thm_export_all')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('thm_export_all')}
                </Button>
              </div>
            )}
          </div>

          {/* 右侧：详细内容与编辑器 */}
          <div className="flex-1 pl-6 py-4 flex flex-col h-full min-w-0">
            <Tabs defaultValue="color" className="w-full flex-1 flex flex-col min-h-0">
              <TabsList className="grid w-full grid-cols-2 h-9 mb-4">
                <TabsTrigger value="color" className="text-xs">🎨 {t('thm_tab_color')}</TabsTrigger>
                <TabsTrigger value="highlight" className="text-xs">🔍 {t('thm_tab_rules')}</TabsTrigger>
              </TabsList>

              {/* 选项卡 1：主题配色 */}
              <TabsContent value="color" className="flex-grow flex flex-col min-h-0 gap-4 mt-0">
                <ScrollArea className="flex-1 pr-2">
                  <div className="flex flex-col gap-4">
                    {/* 实时预览面板 */}
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Monitor className="h-3 w-3" />
                        {t('thm_preview')}
                      </span>
                      <TerminalThemePreview theme={activeTheme} size="lg" />
                    </div>

                    {/* 非自定义主题：展示只读状态 */}
                    {!isCustom && (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-blue-500 text-xs">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold">{t('thm_builtin_readonly')}</span>
                        </div>
                      </div>
                    )}

                    {/* 基本信息 */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">{t('thm_theme_name')}</span>
                        <Input
                          value={editName}
                          onChange={(e) => {
                            setEditName(e.target.value)
                            if (isCustom) {
                              updateCustomTerminalTheme(selectedThemeId, { name: e.target.value })
                            }
                          }}
                          disabled={!isCustom}
                          className="h-8 text-xs"
                          placeholder={t('thm_theme_name_placeholder')}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">{t('thm_theme_type')}</span>
                        <SelectPopover
                          value={editType}
                          onChange={(v) => {
                            const val = (v ?? 'dark') as 'dark' | 'light'
                            setEditType(val)
                            if (isCustom) {
                              updateCustomTerminalTheme(selectedThemeId, { type: val })
                            }
                          }}
                          options={[
                            { value: 'dark', label: t('thm_type_dark') },
                            { value: 'light', label: t('thm_type_light') },
                          ]}
                          disabled={!isCustom}
                          className="h-8"
                          ariaLabel={t('thm_theme_type')}
                        />
                      </div>
                    </div>

                    {/* UI 配色配置 */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{t('thm_ui_base')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3.5 bg-muted/10 p-3 rounded-lg border border-border/50">
                        {/* Background */}
                        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                          <span className="text-[11px] font-medium">{t('thm_background')}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={editBackground}
                              onChange={(e) => {
                                setEditBackground(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: e.target.value,
                                      foreground: editForeground,
                                      cursor: editCursor,
                                      cursorForeground: editCursorForeground,
                                      selection: editSelection,
                                      selectionForeground: editSelectionForeground,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editBackground}</span>
                          </div>
                        </div>

                        {/* Foreground */}
                        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                          <span className="text-[11px] font-medium">{t('thm_foreground')}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={editForeground}
                              onChange={(e) => {
                                setEditForeground(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: e.target.value,
                                      cursor: editCursor,
                                      cursorForeground: editCursorForeground,
                                      selection: editSelection,
                                      selectionForeground: editSelectionForeground,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editForeground}</span>
                          </div>
                        </div>

                        {/* Cursor */}
                        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                          <span className="text-[11px] font-medium">{t('thm_cursor')}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={editCursor}
                              onChange={(e) => {
                                setEditCursor(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: editForeground,
                                      cursor: e.target.value,
                                      cursorForeground: editCursorForeground,
                                      selection: editSelection,
                                      selectionForeground: editSelectionForeground,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editCursor}</span>
                          </div>
                        </div>

                        {/* Cursor Foreground —— 光标所在字符的前景色 */}
                        <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                          <span className="text-[11px] font-medium" title={t('thm_cursor_fg') + '：避免亮色光标 + 亮色背景时字符看不清'}>{t('thm_cursor_fg')}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={editCursorForeground}
                              onChange={(e) => {
                                setEditCursorForeground(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: editForeground,
                                      cursor: editCursor,
                                      cursorForeground: e.target.value,
                                      selection: editSelection,
                                      selectionForeground: editSelectionForeground,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editCursorForeground}</span>
                          </div>
                        </div>

                        {/* Selection Background */}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] font-medium text-primary">{t('thm_selection')}</span>
                          <div className="flex items-center gap-1.5">
                            {/* 选区背景支持 RGBA 透明度，色板支持点击弹出原生的拾色器 */}
                            <div
                              className="relative w-5 h-5 rounded border border-border/60 flex-shrink-0 overflow-hidden cursor-pointer"
                              style={{
                                backgroundImage: `conic-gradient(#ccc 90deg, #fff 90deg 180deg, #ccc 180deg 270deg, #fff 270deg)`,
                                backgroundSize: '8px 8px',
                              }}
                              title={editSelection}
                            >
                              <span
                                className="absolute inset-0 block w-full h-full"
                                style={{ backgroundColor: editSelection }}
                              />
                              <input
                                type="color"
                                value={colorToHex6(editSelection)}
                                onChange={(e) => {
                                  const updatedVal = e.target.value
                                  setEditSelection(updatedVal)
                                  if (isCustom) {
                                    updateCustomTerminalTheme(selectedThemeId, {
                                      ui: {
                                        background: editBackground,
                                        foreground: editForeground,
                                        cursor: editCursor,
                                        cursorForeground: editCursorForeground,
                                        selection: updatedVal,
                                        selectionForeground: editSelectionForeground,
                                      }
                                    })
                                  }
                                }}
                                disabled={!isCustom}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </div>
                            <Input
                              value={editSelection}
                              onChange={(e) => {
                                setEditSelection(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: editForeground,
                                      cursor: editCursor,
                                      cursorForeground: editCursorForeground,
                                      selection: e.target.value,
                                      selectionForeground: editSelectionForeground,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-24 h-6 text-[10px] font-mono px-1 border"
                              placeholder="rgba() 或 #hex"
                            />
                          </div>
                        </div>

                        {/* Selection Foreground —— 选中文本的前景色 */}
                        <div className="flex items-center justify-between gap-2 pt-1">
                          <span className="text-[11px] font-medium text-primary" title={t('thm_selection_fg') + '：选区背景与文字色接近时保证可读'}>{t('thm_selection_fg')}</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={editSelectionForeground}
                              onChange={(e) => {
                                setEditSelectionForeground(e.target.value)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: editForeground,
                                      cursor: editCursor,
                                      cursorForeground: editCursorForeground,
                                      selection: editSelection,
                                      selectionForeground: e.target.value,
                                    }
                                  })
                                }
                              }}
                              disabled={!isCustom}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editSelectionForeground}</span>
                          </div>
                        </div>

                        {/* Active Border —— 窗口激活高亮边框 */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40 col-span-2 sm:col-span-1">
                          <span
                            className="text-[11px] font-medium text-primary"
                            title={t('thm_active_border_hint')}
                          >
                            {t('thm_active_border')}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={colorToHex6(editActiveBorder)}
                              onChange={(e) => {
                                const val = e.target.value
                                setEditActiveBorder(val)
                                if (isCustom) {
                                  updateCustomTerminalTheme(selectedThemeId, {
                                    ui: {
                                      background: editBackground,
                                      foreground: editForeground,
                                      cursor: editCursor,
                                      cursorForeground: editCursorForeground,
                                      selection: editSelection,
                                      selectionForeground: editSelectionForeground,
                                      activeBorder: val,
                                    },
                                  })
                                } else {
                                  setTerminalThemeOverride(selectedThemeId, {
                                    ...terminalThemeOverrides[selectedThemeId],
                                    activeBorder: val,
                                  })
                                }
                              }}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                            />
                            <span className="text-[10px] font-mono select-all w-14">{editActiveBorder}</span>
                            {!isCustom && terminalThemeOverrides[selectedThemeId]?.activeBorder && (
                              <button
                                type="button"
                                onClick={() => {
                                  const current = { ...terminalThemeOverrides[selectedThemeId] }
                                  delete current.activeBorder
                                  if (Object.keys(current).length === 0) {
                                    clearTerminalThemeOverride(selectedThemeId)
                                  } else {
                                    setTerminalThemeOverride(selectedThemeId, current)
                                  }
                                  const defaultColor = PRESET_TERMINAL_THEMES.find((t) => t.id === selectedThemeId)?.ui.activeBorder || '#38bdf8'
                                  setEditActiveBorder(defaultColor)
                                }}
                                title={t('thm_reset_default_border')}
                                className="h-5 w-5 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ANSI 16 配色配置 */}
                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">{t('thm_ansi_16')}</span>
                      <div className="grid grid-cols-2 gap-4 p-3 bg-muted/10 rounded-lg border border-border/50">
                        {/* 标准 8 色 */}
                        <div className="flex flex-col gap-2.5">
                          <span className="text-[10px] font-semibold text-muted-foreground border-b pb-0.5">{t('thm_standard')}</span>
                          {Object.keys(editAnsiColors).slice(0, 8).map((key) => (
                            <div key={key} className="flex items-center justify-between">
                              <span className="text-[11px] font-medium capitalize">{key}</span>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={editAnsiColors[key] || '#000000'}
                                  onChange={(e) => {
                                    const next = { ...editAnsiColors, [key]: e.target.value }
                                    setEditAnsiColors(next)
                                    if (isCustom) {
                                      updateCustomTerminalTheme(selectedThemeId, {
                                        ansi: {
                                          ...activeTheme.ansi,
                                          [key]: e.target.value,
                                        }
                                      })
                                    }
                                  }}
                                  disabled={!isCustom}
                                  className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="text-[10px] font-mono w-14 select-all">{editAnsiColors[key]}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* 明亮 8 色 */}
                        <div className="flex flex-col gap-2.5">
                          <span className="text-[10px] font-semibold text-muted-foreground border-b pb-0.5">{t('thm_bright')}</span>
                          {Object.keys(editAnsiColors).slice(8, 16).map((key) => (
                            <div key={key} className="flex items-center justify-between">
                              <span className="text-[11px] font-medium capitalize">
                                {key.replace('bright', 'Bright ')}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={editAnsiColors[key] || '#000000'}
                                  onChange={(e) => {
                                    const next = { ...editAnsiColors, [key]: e.target.value }
                                    setEditAnsiColors(next)
                                    if (isCustom) {
                                      updateCustomTerminalTheme(selectedThemeId, {
                                        ansi: {
                                          ...activeTheme.ansi,
                                          [key]: e.target.value,
                                        }
                                      })
                                    }
                                  }}
                                  disabled={!isCustom}
                                  className="w-5 h-5 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="text-[10px] font-mono w-14 select-all">{editAnsiColors[key]}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 背景图配置（自定义主题可上传图片+调参；系统主题仅可调参，image 留空） */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{t('thm_bg_title')}</span>
                        {/* 系统预设主题始终显示"恢复默认"按钮：有覆盖层时可点击恢复，无覆盖层时禁用（让用户知道此功能存在，防止误改后找不到恢复入口） */}
                        {!isCustom && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!hasOverride}
                            className="h-6 gap-1 text-[10px] text-amber-500 hover:text-amber-600 hover:bg-amber-500/10 border-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            onClick={handleResetBgOverride}
                          >
                            {t('thm_bg_reset')}
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-col gap-3 p-3 bg-muted/10 rounded-lg border border-border/50">
                        {/* 当前背景预览与清除状态区 */}
                        <div className="flex items-center gap-3 p-2 bg-muted/20 rounded-md border border-border/40">
                          <div
                            className="w-20 h-12 rounded border border-border/50 overflow-hidden flex-shrink-0 flex items-center justify-center bg-black/20 relative shadow-xs"
                            style={editBgImage ? {
                              backgroundImage: `url(${editBgImage})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            } : undefined}
                          >
                            {editBgVideoPath && (
                              <video
                                src={getVideoSrc(editBgVideoPath)}
                                className="w-full h-full object-cover"
                                muted
                                autoPlay
                                loop
                                playsInline
                              />
                            )}
                            {!hasBgMedia && <Monitor className="h-4 w-4 text-muted-foreground/50" />}
                          </div>
                          <div className="flex items-center justify-between flex-1 gap-2 min-w-0">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-xs font-medium text-foreground truncate">
                                {hasBgMedia
                                  ? (editBgType === 'video' ? '当前已应用动态视频背景' : '当前已应用图片背景')
                                  : '纯色终端背景'}
                              </span>
                              <span className="text-[10px] text-muted-foreground leading-tight">
                                {hasBgMedia
                                  ? '从下方点选其他背景即可快速切换，或点击清除恢复纯色'
                                  : '未设置背景，可从下方点选预置背景或在图片库中上传'}
                              </span>
                            </div>

                            {hasBgMedia && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2.5 gap-1 text-[11px] text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 border-rose-500/30 shrink-0 cursor-pointer"
                                onClick={handleClearBgImage}
                                title="清除当前背景，恢复纯色终端"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>清除背景</span>
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* 预置背景选择区：打包在应用内的图片/视频，用户可快速点选。
                            PRESET_BACKGROUNDS 为空时此区域不渲染。 */}
                        {PRESET_BACKGROUNDS.length > 0 && (
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-medium text-primary">{t('thm_bg_preset_title')}</span>
                              <span className="text-[9px] text-muted-foreground">{t('thm_bg_preset_hint')}</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1.5">
                              {PRESET_BACKGROUNDS.map((preset) => {
                                const thumbUrl = presetBgUrls.get(preset.id)
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    title={t(preset.nameKey)}
                                    onClick={() => handleSelectPresetBg(preset)}
                                    className={cn(
                                      'relative aspect-video rounded border overflow-hidden flex items-center justify-center bg-black/20 transition-all group',
                                      editBgImage && thumbUrl === editBgImage
                                        ? 'border-primary ring-2 ring-primary'
                                        : 'border-border/50 hover:border-primary hover:ring-1 hover:ring-primary',
                                    )}
                                  >
                                    {thumbUrl ? (
                                      preset.type === 'video' ? (
                                        <video
                                          src={thumbUrl}
                                          className="w-full h-full object-cover"
                                          muted
                                          loop
                                          playsInline
                                          onMouseEnter={(e) => { (e.target as HTMLVideoElement).play().catch(() => {}) }}
                                          onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause() }}
                                        />
                                      ) : (
                                        <div
                                          className="w-full h-full bg-cover bg-center"
                                          style={{ backgroundImage: `url(${thumbUrl})` }}
                                        />
                                      )
                                    ) : (
                                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                    )}
                                    {/* 类型角标 */}
                                    <span className="absolute top-0.5 right-0.5 px-1 rounded-sm bg-black/60 text-white text-[8px] leading-tight">
                                      {preset.type === 'video' ? 'V' : 'I'}
                                    </span>
                                    {editBgImage && thumbUrl === editBgImage && (
                                      <span
                                        title={t('thm_bg_selected')}
                                        className="absolute top-0.5 left-0.5 p-0.5 rounded-sm bg-primary text-primary-foreground"
                                      >
                                        <Check className="h-3 w-3" />
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* 用户图片库：动态扫描 appDataDir/backgrounds/，自动识别各种图片文件。
                            上传仅入库（不立即应用），点选缩略图应用，右上角可删除。 */}
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-medium text-primary">{t('thm_bg_library_title')}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 gap-1 text-[10px]"
                              onClick={() => libImageInputRef.current?.click()}
                            >
                              <Upload className="h-3 w-3" />
                              {t('thm_bg_add_to_library')}
                            </Button>
                          </div>
                          {userBgLoading ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <QshellLoader size="xs" text={t('thm_bg_library_loading')} />
                            </div>
                          ) : userBgList.length === 0 ? (
                            <span className="text-[10px] text-muted-foreground">{t('thm_bg_library_empty')}</span>
                          ) : (
                            <div className="grid grid-cols-5 gap-1.5">
                              {userBgList.map((bg) => {
                                const isSelected = editBgImage === bg.url || editBgVideoPath === bg.path
                                return (
                                  <button
                                    key={bg.id}
                                    type="button"
                                    title={bg.name}
                                    onClick={() => handleSelectUserBg(bg)}
                                    className={cn(
                                      'relative aspect-video rounded border overflow-hidden flex items-center justify-center bg-black/20 transition-all group',
                                      isSelected
                                        ? 'border-primary ring-2 ring-primary'
                                        : 'border-border/50 hover:border-primary hover:ring-1 hover:ring-primary',
                                    )}
                                  >
                                    {bg.type === 'video' ? (
                                      <video
                                        src={bg.url}
                                        className="w-full h-full object-cover"
                                        muted
                                        loop
                                        playsInline
                                        onMouseEnter={(e) => { (e.target as HTMLVideoElement).play().catch(() => {}) }}
                                        onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause() }}
                                      />
                                    ) : (
                                      <div
                                        className="w-full h-full bg-cover bg-center"
                                        style={{ backgroundImage: `url(${bg.url})` }}
                                      />
                                    )}
                                    {/* 类型角标 */}
                                    <span className="absolute top-0.5 right-0.5 px-1 rounded-sm bg-black/60 text-white text-[8px] leading-tight group-hover:opacity-0 transition-opacity">
                                      {bg.type === 'video' ? 'V' : 'I'}
                                    </span>
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      title={t('thm_bg_library_delete')}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteUserBg(bg)
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.stopPropagation()
                                          handleDeleteUserBg(bg)
                                        }
                                      }}
                                      className="absolute top-0.5 right-0.5 p-0.5 rounded-sm bg-black/60 text-white text-[9px] leading-none opacity-0 group-hover:opacity-100 hover:text-rose-400 cursor-pointer"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </span>
                                    {isSelected && (
                                      <span
                                        title={t('thm_bg_selected')}
                                        className="absolute top-0.5 left-0.5 p-0.5 rounded-sm bg-primary text-primary-foreground"
                                      >
                                        <Check className="h-3 w-3" />
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                          <input
                            ref={libImageInputRef}
                            type="file"
                            accept="image/*,video/mp4,video/webm,video/ogg,video/quicktime"
                            multiple
                            onChange={handleAddToLibrary}
                            className="hidden"
                          />
                        </div>

                        {/* 背景色不透明度滑块（控制背景媒体透出程度）。无背景时禁用。 */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-primary" title={t('thm_bg_opacity_hint')}>{t('thm_bg_opacity')}</span>
                          <div className="flex items-center gap-2 flex-1 max-w-[160px]">
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={editBgOpacity}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value)
                                setEditBgOpacity(v)
                                updateBgConfig({ opacity: v })
                              }}
                              disabled={!hasBgMedia}
                              className="flex-1 h-1 accent-emerald-500"
                            />
                            <span className="text-[10px] font-mono w-8 text-right">{Math.round(editBgOpacity * 100)}%</span>
                          </div>
                        </div>

                        {/* 背景模糊度滑块 */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-primary" title={t('thm_bg_blur_hint')}>{t('thm_bg_blur')}</span>
                          <div className="flex items-center gap-2 flex-1 max-w-[160px]">
                            <input
                              type="range"
                              min={0}
                              max={20}
                              step={1}
                              value={editBgBlur}
                              onChange={(e) => {
                                const v = parseInt(e.target.value)
                                setEditBgBlur(v)
                                updateBgConfig({ blur: v })
                              }}
                              disabled={!hasBgMedia}
                              className="flex-1 h-1 accent-emerald-500"
                            />
                            <span className="text-[10px] font-mono w-8 text-right">{editBgBlur}px</span>
                          </div>
                        </div>

                        {/* 背景尺寸模式 */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-primary">{t('thm_bg_size')}</span>
                          <div className="flex gap-1 bg-muted/30 rounded p-0.5">
                            {(['cover', 'contain', 'center'] as const).map((s) => (
                              <button
                                key={s}
                                disabled={!hasBgMedia}
                                onClick={() => {
                                  setEditBgSize(s)
                                  updateBgConfig({ size: s })
                                }}
                                className={cn(
                                  'px-2 py-0.5 text-[10px] rounded transition-colors',
                                  editBgSize === s
                                    ? 'bg-background shadow-sm text-primary font-medium'
                                    : 'text-muted-foreground hover:text-primary',
                                  !hasBgMedia && 'opacity-50 cursor-not-allowed',
                                )}
                              >
                                {t(`thm_bg_size_${s}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>

                <div className="pt-3 border-t flex items-center justify-end mt-auto gap-2">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isCustom && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 border-emerald-500/20"
                        onClick={handleCloneTheme}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {t('thm_clone')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => {
                        setTerminalThemeId(selectedThemeId)
                        setTimeout(() => onOpenChange(false), 80)
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {t('thm_apply')}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* 选项卡 2：日志高亮规则引擎 */}
              <TabsContent value="highlight" className="flex-grow flex flex-col min-h-0 mt-0 gap-4">
                {/* 顶部总开关 */}
                <div className="flex items-center justify-between p-3.5 bg-muted/10 rounded-lg border border-border/60">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold">{t('thm_rules_title')}</span>
                    <span className="text-[10.5px] text-muted-foreground">
                      {t('thm_rules_desc')}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={terminalHighlightEnabled}
                    onChange={(e) => setTerminalHighlightEnabled(e.target.checked)}
                    className="w-9 h-5 rounded-full bg-muted border-border cursor-pointer accent-primary appearance-none relative transition-all before:content-[''] before:absolute before:h-3.5 before:w-3.5 before:rounded-full before:bg-white before:top-[2px] before:left-[3px] before:transition-all checked:bg-primary checked:before:translate-x-4 border flex items-center"
                  />
                </div>

                <div className="flex-1 flex flex-col min-h-0 gap-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-muted-foreground">{t('thm_rule_list')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!terminalHighlightEnabled}
                      className="h-6 text-[10px] gap-1 hover:text-primary"
                      onClick={handleAddRule}
                    >
                      <Plus className="h-3 w-3" /> {t('thm_add_rule')}
                    </Button>
                  </div>

                  <ScrollArea className="flex-1 border rounded-lg bg-card/40 p-2.5">
                    <div className="flex flex-col gap-2.5 pr-2.5">
                      {terminalHighlightRules.length === 0 ? (
                        <div className="text-center py-12 text-xs text-muted-foreground flex flex-col items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-muted-foreground/60" />
                          {t('thm_no_rules')}
                        </div>
                      ) : (
                        terminalHighlightRules.map((rule) => {
                          // 检查正则合法性
                          let isRegexValid = true
                          try {
                            new RegExp(rule.regex)
                          } catch {
                            isRegexValid = false
                          }

                          return (
                            <div
                              key={rule.id}
                              className={`flex items-center gap-3 p-2 bg-background border rounded-md transition-opacity duration-150 ${
                                !terminalHighlightEnabled || !rule.enabled ? 'opacity-50' : ''
                              }`}
                            >
                              {/* 开关勾选 */}
                              <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={(e) => updateHighlightRule(rule.id, { enabled: e.target.checked })}
                                disabled={!terminalHighlightEnabled}
                                className="w-4 h-4 cursor-pointer accent-primary"
                                title={t('thm_toggle_rule')}
                              />

                              {/* 规则名称 */}
                              <Input
                                value={rule.name}
                                onChange={(e) => updateHighlightRule(rule.id, { name: e.target.value })}
                                disabled={!terminalHighlightEnabled}
                                className="h-7 w-28 text-xs font-medium px-2"
                                placeholder={t('thm_rule_name_placeholder')}
                              />

                              {/* 正则表达式 */}
                              <div className="flex-1 relative">
                                <Input
                                  value={rule.regex}
                                  onChange={(e) => updateHighlightRule(rule.id, { regex: e.target.value })}
                                  disabled={!terminalHighlightEnabled}
                                  className={`h-7 text-xs font-mono px-2 pr-6 ${
                                    !isRegexValid ? 'border-destructive text-destructive bg-destructive/5' : ''
                                  }`}
                                  placeholder={t('thm_regex_placeholder')}
                                />
                                {!isRegexValid && (
                                  <span
                                    className="absolute right-2 top-1.5 text-destructive font-bold text-xs"
                                    title={t('thm_regex_invalid')}
                                  >
                                    !
                                  </span>
                                )}
                              </div>

                              {/* 拾色器 */}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <input
                                  type="color"
                                  value={rule.color}
                                  onChange={(e) => updateHighlightRule(rule.id, { color: e.target.value })}
                                  disabled={!terminalHighlightEnabled}
                                  className="w-5 h-5 rounded cursor-pointer border-0 p-0 disabled:opacity-50"
                                />
                                <span className="text-[9px] font-mono w-12 select-all hidden sm:inline">
                                  {rule.color}
                                </span>
                              </div>

                              {/* 删除按钮 */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteHighlightRule(rule.id)}
                                disabled={!terminalHighlightEnabled}
                                title={t('thm_delete_rule')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="pt-3 border-t mt-auto flex justify-end">
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => onOpenChange(false)}>
                    <Check className="h-3.5 w-3.5" />
                    {t('thm_ok')}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
