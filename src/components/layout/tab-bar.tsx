import { useState, useRef, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Home,
  Settings,
  ArrowLeftRight,
  Lock,
  Cloud,
  Loader2,
  ChevronDown,
  CloudUpload,
} from 'lucide-react'
import type { WorkspaceTab } from '@/types'
import { useTranslation } from '@/i18n'
import { useSyncStore } from '@/store/sync-store'
import { useToast } from '@/components/ui/toast'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { SettingsDialog } from '@/components/layout/settings-dialog'
import { TabStrip } from '@/components/layout/tab-strip'
import { UserAvatar } from '@/components/ui/user-avatar'
import { cn } from '@/lib/utils'
import { isTauri } from '@/services/api'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

function formatRelativeTime(isoStr: string | null): string {
  if (!isoStr) return ''
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return '刚刚'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}分钟前`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}小时前`
    return new Date(isoStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  } catch {
    return ''
  }
}

/**
 * 顶层标签栏外壳：承载全局工具按钮（首页/SFTP/设置）。
 * 中间区域始终渲染统一的 TabStrip（包含全部标签，无论是否分屏）——
 * 分屏只影响内容区，顶部始终只有这一个标签栏。
 */
export function TabBar() {
  const { t } = useTranslation()
  const { toast } = useToast()
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

  const provider = useSyncStore((s) => s.provider)
  const isConfigured = useSyncStore((s) => s.isConfigured)
  const isSyncing = useSyncStore((s) => s.isSyncing)
  const currentUser = useSyncStore((s) => s.currentUser)
  const masterPassword = useSyncStore((s) => s.masterPassword)
  const lastSyncTime = useSyncStore((s) => s.lastSyncTime)
  const backup = useSyncStore((s) => s.backup)

  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<
    "general" | "security" | "account" | "terminal" | "sftp" | "logs" | "shortcuts" | "known_hosts"
  >("general")

  const handleQuickBackup = async () => {
    if (!masterPassword) {
      setSettingsTab('account')
      setShowSettings(true)
      toast.warning('请先设置同步主密码以保护您的配置')
      return
    }
    const res = await backup()
    if (res.success) {
      toast.success('配置已成功加密同步至云端私有仓库！')
    } else {
      toast.error(`同步失败: ${res.error}`)
    }
  }

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

      {/* 右侧：用户与全局设置下拉菜单 (统一收纳云同步、快捷备份、设置等) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="group h-full px-2.5 flex items-center gap-1.5 border-l border-border/40 text-[11px] text-foreground hover:bg-muted/40 transition-colors focus:outline-none data-[state=open]:bg-muted/60 select-none cursor-pointer"
            title={
              isConfigured && currentUser
                ? `${currentUser.name || currentUser.login} (@${currentUser.login}) - 点击展开控制菜单`
                : '账户与设置 - 点击展开控制菜单'
            }
          >
            {isSyncing ? (
              <div className="flex items-center gap-1.5 text-primary">
                <Loader2
                  className={cn(
                    'h-3.5 w-3.5 animate-spin',
                    provider === 'gitee' ? 'text-red-500' : 'text-primary',
                  )}
                />
                <span className="text-[10px] hidden sm:inline font-medium">同步中</span>
              </div>
            ) : isConfigured && currentUser ? (
              <div className="flex items-center gap-1.5">
                <UserAvatar
                  url={currentUser.avatar_url}
                  name={currentUser.name || currentUser.login}
                  className={cn(
                    'h-4 w-4 ring-1 shrink-0',
                    provider === 'gitee' ? 'ring-red-500/50' : 'ring-primary/50',
                  )}
                  fallbackClassName={cn(
                    'h-4 w-4 font-bold text-[9px] shrink-0',
                    provider === 'gitee' ? 'bg-red-500/20 text-red-500' : 'bg-primary/20 text-primary',
                  )}
                />
                <span className="hidden xl:inline max-w-[84px] truncate text-[11px] font-medium text-foreground">
                  {currentUser.name || currentUser.login}
                </span>
                <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                <Settings className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] hidden sm:inline font-medium">设置</span>
                <ChevronDown className="h-3 w-3 opacity-60 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={6} className="w-64 p-2 glass-strong border border-border/60 rounded-xl shadow-xl space-y-1">
          {/* 1. 用户信息卡片（可点击直达云同步设置） */}
          <div
            onClick={() => {
              setSettingsTab('account')
              setShowSettings(true)
            }}
            className="p-2.5 rounded-lg bg-muted/40 hover:bg-muted/70 transition-colors border border-border/50 cursor-pointer group select-none"
            title="点击前往云同步管理"
          >
            {isConfigured && currentUser ? (
              <div className="flex items-center gap-2.5">
                <UserAvatar
                  url={currentUser.avatar_url}
                  name={currentUser.name || currentUser.login}
                  className={cn(
                    'h-8 w-8 ring-2 shrink-0',
                    provider === 'gitee' ? 'ring-red-500/40' : 'ring-primary/40',
                  )}
                  fallbackClassName={cn(
                    'h-8 w-8 ring-2 shrink-0',
                    provider === 'gitee' ? 'ring-red-500/40' : 'ring-primary/40',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-semibold text-xs text-foreground truncate">
                      {currentUser.name || currentUser.login}
                    </div>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.2 rounded-md font-medium shrink-0',
                        provider === 'gitee'
                          ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                          : 'bg-primary/10 text-primary border border-primary/20',
                      )}
                    >
                      {provider === 'gitee' ? '🇨🇳 Gitee' : '🌐 GitHub'}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    @{currentUser.login}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>云同步就绪</span>
                    {lastSyncTime && (
                      <span className="text-muted-foreground ml-auto">
                        {formatRelativeTime(lastSyncTime)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Cloud className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">
                    多端云同步 (未配置)
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                    点击前往绑定私有仓库
                  </p>
                </div>
              </div>
            )}
          </div>

          <DropdownMenuSeparator className="my-1" />

          {/* 2. 核心可用操作 */}
          <DropdownMenuGroup>
            {isConfigured && (
              <DropdownMenuItem
                onClick={handleQuickBackup}
                disabled={isSyncing}
                className="text-xs gap-2 py-2 cursor-pointer"
              >
                <CloudUpload className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 flex items-center justify-between">
                  <span>立即同步备份</span>
                  {isSyncing && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </div>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => {
                setSettingsTab('account')
                setShowSettings(true)
              }}
              className="text-xs gap-2 py-2 cursor-pointer"
            >
              <Cloud className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>云同步管理...</span>
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => {
                setSettingsTab('general')
                setShowSettings(true)
              }}
              className="text-xs gap-2 py-2 cursor-pointer"
            >
              <Settings className="h-3.5 w-3.5 text-foreground/80 shrink-0" />
              <span>系统偏好设置...</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 全局设置弹窗 */}
      <SettingsDialog
        open={showSettings}
        defaultTab={settingsTab}
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
