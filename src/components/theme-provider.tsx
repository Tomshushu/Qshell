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

    // 同步系统原生窗口主题（影响 Windows 标题栏颜色、滚动条等）
    const syncTauriWindowTheme = (effectiveTheme: 'light' | 'dark') => {
      if (!isTauri) return
      const winTheme = theme === 'system' ? null : effectiveTheme
      getCurrentWebviewWindow()
        .setTheme(winTheme)
        .catch((err) => console.error('[theme] setTheme failed:', err))
    }

    // 原子化切换主题 class：先 add 新主题再 remove 旧主题，杜绝中间出现既没有 .light 也没有 .dark 导致的白屏闪烁
    const applyTheme = (targetTheme: 'light' | 'dark') => {
      if (targetTheme === 'dark') {
        root.classList.add('dark')
        root.classList.remove('light')
      } else {
        root.classList.add('light')
        root.classList.remove('dark')
      }
      syncTauriWindowTheme(targetTheme)
    }

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const applySystemTheme = () => {
        applyTheme(mediaQuery.matches ? 'dark' : 'light')
      }
      applySystemTheme()
      mediaQuery.addEventListener('change', applySystemTheme)
      return () => mediaQuery.removeEventListener('change', applySystemTheme)
    } else {
      applyTheme(theme)
    }
  }, [theme])

  return <>{children}</>
}
