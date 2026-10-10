import { useState, useRef, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Home, Settings, ArrowLeftRight, Lock, User as UserIcon,
} from 'lucide-react'
import type { WorkspaceTab } from '@/types'
import { useTranslation } from '@/i18n'
import { useAuthStore } from '@/store/auth-store'
import { SettingsDialog } from '@/components/layout/settings-dialog'
import { TabStrip } from '@/components/layout/tab-strip'
import { cn } from '@/lib/utils'
import { isTauri } from '@/services/api'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * 顶层标签栏外壳：承载全局工具按钮（首页/SFTP/设置）。
 * 中间区域始终渲染统一的 TabStrip（包含全部标签，无论是否分屏）——
 * 分屏只影响内容区，顶部始终只有这一个标签栏。
 */
export function TabBar() {
  const { t } = useTranslation()
  const tabs = useAppStore((s) => s.tabs)
  const isHomeActive = useAppStore((s) => !s.activeTabId)
  const isSftpActive = useAppStore((s) =>
    Boolean(s.activeTabId && s.tabs.some((t) => t.serverId === 'sftp' && t.id === s.activeTabId)),
  )
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const openTab = useAppStore((s) => s.openTab)
  const mergeTab = useAppStore((s) => s.mergeTab)
  const appLockEnabled = useAppStore((s) => s.appLockEnabled)
  const appLockPasswordHash = useAppStore((s) => s.appLockPasswordHash)
  const lockApp = useAppStore((s) => s.lockApp)
  const user = useAuthStore((s) => s.user)
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog)

  const [showSettings, setShowSettings] = useState(false)

  // 当前窗口 label（合并功能使用）
  const currentWindowLabel = useRef<string>('main')

  useEffect(() => {
    if (isTauri) {
      try {
        currentWindowLabel.current = getCurrentWebviewWindow().label
      } catch { /* ignore */ }
    }
  }, [])

  // ── 监听跨窗口合并事件（保留，其他窗口仍可通过 API 合并标签） ──────────
  useEffect(() => {
    if (!isTauri) return
    let cancelled = false
    let unlisten: UnlistenFn | undefined
    listen<{ tab: WorkspaceTab; targetWindow: string }>('tab-merge-request', (event) => {
      if (event.payload.targetWindow !== currentWindowLabel.current) return
      mergeTab(event.payload.tab)
    }).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    }).catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [mergeTab])

  const nonSftpTabs = useMemo(() => tabs.filter((t) => t.serverId !== 'sftp'), [tabs])

  return (
    <div className="theme-tab-bar flex h-9 items-center select-none">
      {/* 首页按钮：接入统一的 theme-tab-item 设计语言 */}
      <button
        type="button"
        className={cn(
          'theme-tab-item mx-0.5 my-0.5 flex h-[calc(100%-6px)] flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-3 text-xs',
          isHomeActive && 'is-active',
        )}
        onClick={() => setActiveTab(null)}
        title={t('tab_home')}
      >
        <Home className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{t('tab_home')}</span>
      </button>

      {/* 固定的 SFTP 标签：接入统一的 theme-tab-item 设计语言 */}
      <button
        type="button"
        className={cn(
          'theme-tab-item mx-0.5 my-0.5 flex h-[calc(100%-6px)] flex-shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-3 text-xs',
          isSftpActive && 'is-active',
        )}
        onClick={() => openTab('sftp', t('nav_sftp'), 'files')}
        title={t('nav_sftp')}
      >
        <ArrowLeftRight className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{t('nav_sftp')}</span>
      </button>

      {/* 中间区域：统一标签条（SFTP 固定标签由上方按钮承载，不在条内渲染） */}
      <TabStrip tabs={nonSftpTabs} className="flex-1 overflow-hidden" />

      {/* 右侧：应用锁（Termius 风格离席锁定） */}
      <Button
        variant="ghost"
        size="sm"
        className="h-full px-2 rounded-none border-l border-border/40 text-[11px] flex-shrink-0 hover:text-amber-400"
        onClick={() => {
          if (appLockEnabled && appLockPasswordHash) {
            lockApp()
          } else {
            window.dispatchEvent(
              new CustomEvent('open-app-lock-setup', {
                detail: { lockImmediately: true },
              }),
            )
          }
        }}
        title={`${t('app_lock_btn_title') || '应用锁'} (Ctrl+Alt+L)`}
      >
        <Lock className="h-3 w-3" />
      </Button>

      {/* 右侧：全局设置 */}
      <Button
        variant="ghost"
        size="sm"
        className="h-full px-2 rounded-none border-l border-border/40 text-[11px] flex-shrink-0"
        onClick={() => setShowSettings(true)}
        title={t('nav_settings')}
      >
        <Settings className="h-3 w-3" />
      </Button>

      {/* 右侧：用户账号与云端同步 */}
      <Button
        variant="ghost"
        size="sm"
        className="h-full px-2 rounded-none border-l border-border/40 text-[11px] flex-shrink-0 gap-1.5 hover:text-primary"
        onClick={openAuthDialog}
        title={user ? `${user.email || '已连接云端'} (点击查看账号)` : `${t('sidebar_account') || '账号'} (登录/注册)`}
      >
        {user ? (
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 rounded-full bg-primary/20 text-primary font-bold text-[9px] flex items-center justify-center">
              {user.email?.slice(0, 1).toUpperCase() || 'U'}
            </div>
            <span className="hidden xl:inline max-w-[80px] truncate text-[10px]">
              {user.email?.split('@')[0]}
            </span>
          </div>
        ) : (
          <UserIcon className="h-3 w-3" />
        )}
      </Button>

      {/* 全局设置弹窗 */}
      <SettingsDialog
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) {
            window.dispatchEvent(new CustomEvent('focus-active-terminal'));
          }
        }}
      />
    </div>
  )
}
