import { useEffect } from 'react'
import { useAppStore } from '@/store'

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

      const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
      const hasMod = e.ctrlKey || (isMac && e.metaKey)
      const hasAlt = e.altKey
      const key = e.key?.toLowerCase()

      // Ctrl+Alt+L / Cmd+Option+L: 触发应用锁
      if (hasMod && hasAlt && key === 'l') {
        e.preventDefault()
        if (appLockEnabled && appLockPasswordHash) {
          lockApp()
        } else {
          window.dispatchEvent(new CustomEvent('open-app-lock-setup', { detail: { lockImmediately: true } }))
        }
        return
      }

      // Ctrl+T / Cmd+T: 打开新终端标签
      if (hasMod && !e.shiftKey && key === 't') {
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

      // Ctrl+W / Cmd+W: 关闭当前标签（经统一守卫：首次二次确认，勾选「不再提醒」后直接关闭）
      if (hasMod && !e.shiftKey && key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          // TabStrip 常驻渲染，统一监听该事件弹确认框
          window.dispatchEvent(
            new CustomEvent('qshell:request-close-tab', { detail: activeTabId }),
          )
        }
        return
      }

      // Ctrl+Tab: 切换到下一个标签
      if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
        e.preventDefault()
        if (tabs.length > 1 && activeTabId) {
          const currentIndex = tabs.findIndex((t) => t.id === activeTabId)
          const nextIndex = (currentIndex + 1) % tabs.length
          setActiveTab(tabs[nextIndex].id)
        }
        return
      }

      // Ctrl+Shift+Tab: 切换到上一个标签
      if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
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
