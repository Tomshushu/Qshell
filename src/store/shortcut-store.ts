import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SHORTCUT_DEFINITIONS, type ShortcutDefinition } from '@/types/shortcuts'
import {
  matchesShortcut,
  acceleratorToDisplayKeys,
  isMacPlatform,
  parseAccelerator,
} from '@/utils/shortcut-matcher'

interface ShortcutState {
  /** 用户自定义覆盖映射：actionId -> 自定义加速键（如 'Ctrl+Shift+P'） */
  customBindings: Record<string, string>

  /** 获取指定动作当前的有效绑定字符串 */
  getBinding: (actionId: string) => string

  /** 获取指定动作当前的 UI 展示徽章单元数组 */
  getDisplayKeys: (actionId: string) => string[]

  /** 获取动作定义元信息 */
  getDefinition: (actionId: string) => ShortcutDefinition | undefined

  /** 查找指定加速键是否与其它动作产生冲突（实时录制感知） */
  findConflict: (actionId: string, accelerator: string) => ShortcutDefinition | undefined

  /** 设置/修改快捷键绑定，并检测是否有热键冲突 */
  setBinding: (actionId: string, accelerator: string) => {
    success: boolean
    conflictActionId?: string
  }

  /** 清空指定动作的快捷键绑定（置为空） */
  clearBinding: (actionId: string) => void

  /** 重置单个快捷键为系统默认 */
  resetBinding: (actionId: string) => void

  /** 重置所有快捷键为系统默认 */
  resetAll: () => void

  /** 判断当前事件是否命中了任意全局/标签页动作（供终端 xterm.js 动态放行） */
  isGlobalAction: (event: KeyboardEvent) => boolean

  /** 判断当前事件是否命中了指定动作 */
  matchesAction: (event: KeyboardEvent, actionId: string) => boolean
}

function resolveDefaultKey(def: ShortcutDefinition, isMac: boolean): string {
  if (isMac && def.defaultMacKey) {
    return def.defaultMacKey
  }
  return def.defaultKey
}

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      customBindings: {},

      getDefinition: (actionId: string) => {
        return SHORTCUT_DEFINITIONS.find((def) => def.id === actionId)
      },

      getBinding: (actionId: string) => {
        if (actionId in get().customBindings) {
          return get().customBindings[actionId]
        }
        const def = get().getDefinition(actionId)
        if (!def) return ''
        return resolveDefaultKey(def, isMacPlatform())
      },

      getDisplayKeys: (actionId: string) => {
        const binding = get().getBinding(actionId)
        return acceleratorToDisplayKeys(binding, isMacPlatform())
      },

      findConflict: (actionId: string, accelerator: string) => {
        if (!accelerator) return undefined
        const isMac = isMacPlatform()
        const targetParsed = parseAccelerator(accelerator, isMac)
        if (!targetParsed.key) return undefined

        for (const def of SHORTCUT_DEFINITIONS) {
          if (def.id === actionId) continue
          const otherBinding = get().getBinding(def.id)
          if (!otherBinding) continue
          const otherParsed = parseAccelerator(otherBinding, isMac)
          const isSame =
            otherParsed.ctrl === targetParsed.ctrl &&
            otherParsed.alt === targetParsed.alt &&
            otherParsed.shift === targetParsed.shift &&
            otherParsed.meta === targetParsed.meta &&
            otherParsed.key.toLowerCase() === targetParsed.key.toLowerCase()

          if (isSame) {
            return def
          }
        }
        return undefined
      },

      setBinding: (actionId: string, accelerator: string) => {
        const conflictDef = get().findConflict(actionId, accelerator)
        const conflictActionId = conflictDef?.id

        // 保存新映射
        set((state) => {
          const next = { ...state.customBindings, [actionId]: accelerator }
          // 如果产生冲突且用户确认绑定，将冲突方的绑定置空以避免按键打架
          if (conflictActionId) {
            next[conflictActionId] = ''
          }
          return { customBindings: next }
        })

        return { success: true, conflictActionId }
      },

      clearBinding: (actionId: string) => {
        set((state) => ({
          customBindings: {
            ...state.customBindings,
            [actionId]: '',
          },
        }))
      },

      resetBinding: (actionId: string) => {
        set((state) => {
          const next = { ...state.customBindings }
          delete next[actionId]
          return { customBindings: next }
        })
      },

      resetAll: () => {
        set({ customBindings: {} })
      },

      isGlobalAction: (event: KeyboardEvent) => {
        // 全局放行判定：只要匹配任一全局/标签页动作，即放行冒泡
        for (const def of SHORTCUT_DEFINITIONS) {
          if (def.scope === 'global') {
            const binding = get().getBinding(def.id)
            if (matchesShortcut(event, binding)) {
              return true
            }
          }
        }
        return false
      },

      matchesAction: (event: KeyboardEvent, actionId: string) => {
        const binding = get().getBinding(actionId)
        return matchesShortcut(event, binding)
      },
    }),
    {
      name: 'qshell_custom_shortcuts_v1',
      partialize: (state) => ({ customBindings: state.customBindings }),
    },
  ),
)
