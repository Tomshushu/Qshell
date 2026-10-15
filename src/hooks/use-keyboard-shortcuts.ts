import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { useShortcutStore } from '@/store/shortcut-store'

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        openTab,
        setActiveTab,
        tabs,
        activeTabId,
        isAppLocked,
        appLockEnabled,
        appLockPasswordHash,
        lockApp,
      } = useAppStore.getState()

      // 锁屏期间拦截所有全局应用快捷键
      if (isAppLocked) return

      const { matchesAction } = useShortcutStore.getState()

      // 触发应用锁（默认 Mod+Alt+L）
      if (matchesAction(e, 'app.lock')) {
        e.preventDefault()
        if (appLockEnabled && appLockPasswordHash) {
          lockApp()
        } else {
          window.dispatchEvent(
            new CustomEvent('open-app-lock-setup', { detail: { lockImmediately: true } }),
          )
        }
        return
      }

      // 打开新终端标签（默认 Mod+T）
      if (matchesAction(e, 'tab.new')) {
        e.preventDefault()
        // 如果有活跃标签，在同一服务器上打开终端；否则不做操作
        if (activeTabId) {
          const activeTab = tabs.find((t) => t.id === activeTabId)
          if (activeTab) {
            openTab(activeTab.serverId, activeTab.serverName, 'terminal')
          }
        }
        return
      }

      // 关闭当前标签（默认 Mod+W，经统一守卫确认）
      if (matchesAction(e, 'tab.close')) {
        e.preventDefault()
        if (activeTabId) {
          window.dispatchEvent(
            new CustomEvent('qshell:request-close-tab', { detail: activeTabId }),
          )
        }
        return
      }

      // 切换到下一个标签（默认 Ctrl+Tab）
      if (matchesAction(e, 'tab.next')) {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
          const nextIndex = (currentIndex + 1) % tabs.length
          setActiveTab(tabs[nextIndex].id)
        }
        return
      }

      // 切换到上一个标签（默认 Ctrl+Shift+Tab）
      if (matchesAction(e, 'tab.prev')) {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
          const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
          setActiveTab(tabs[prevIndex].id)
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
