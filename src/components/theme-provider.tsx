import { useLayoutEffect } from 'react'
import { useAppStore } from '@/store'
import { isTauri } from '@/services/api'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppStore((s) => s.theme)
  const uiStyle = useAppStore((s) => s.uiStyle)
  const customCursorEnabled = useAppStore((s) => s.customCursorEnabled ?? true)

  // 界面设计语言：在根元素统一标记 data-ui-style 与 data-custom-cursor，同时向后兼容保留 data-theme="ubuntu"
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-ui-style', uiStyle || 'ubuntu')
    root.setAttribute('data-custom-cursor', customCursorEnabled ? 'true' : 'false')
    if (uiStyle === 'ubuntu') {
      root.setAttribute('data-theme', 'ubuntu')
    } else {
      root.removeAttribute('data-theme')
    }
  }, [uiStyle, customCursorEnabled])

  // 全局鼠标按下/拖动态追踪：在根元素标记 data-mouse-down，无缝支持点击按住与拖拽瞄准/踩踩肉垫效果
  useLayoutEffect(() => {
    const root = document.documentElement
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        root.setAttribute('data-mouse-down', 'true')
      }
    }
    const handleMouseUp = () => {
      root.removeAttribute('data-mouse-down')
    }
    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mouseup', handleMouseUp, true)
    window.addEventListener('blur', handleMouseUp)
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      window.removeEventListener('blur', handleMouseUp)
    }
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.remove('light', 'dark')

    // 同步系统原生窗口主题（影响 Windows 标题栏颜色、滚动条等）
    const syncTauriWindowTheme = () => {
      if (!isTauri) return
      // 'system' 传 null 让窗口跟随系统；否则传 'light' | 'dark'
      const winTheme = theme === 'system' ? null : theme
      getCurrentWebviewWindow()
        .setTheme(winTheme)
        .catch((err) => console.error('[theme] setTheme failed:', err))
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

      const applySystemTheme = () => {
        root.classList.remove('light', 'dark')
        root.classList.add(mediaQuery.matches ? 'dark' : 'light')
        syncTauriWindowTheme()
      }

      applySystemTheme()

      mediaQuery.addEventListener('change', applySystemTheme)
      return () => mediaQuery.removeEventListener('change', applySystemTheme)
    } else {
      root.classList.add(theme)
      syncTauriWindowTheme()
    }
  }, [theme])

  return <>{children}</>
}
