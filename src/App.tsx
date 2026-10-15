import { ThemeProvider } from '@/components/theme-provider'
import { ErrorBoundary } from '@/components/error-boundary'
import { TabBar } from '@/components/layout/tab-bar'
import { StatusBar } from '@/components/layout/status-bar'
import { SplitLayoutView } from '@/components/layout/split-layout-view'
import { Dashboard } from '@/pages/dashboard'
import { useAppStore } from '@/store'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useOverflowTitle } from '@/hooks/use-overflow-title'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast-provider'
import { I18nProvider } from '@/i18n/i18n-provider'
import { useTranslation } from '@/i18n'
import { sshService } from '@/services/ssh-service'
import { backend, isTauri } from '@/services/api'
import type { SshKeyInput } from '@/services/api'
import type { WorkspaceTab } from '@/types'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AlertCircle, Copy, ShieldCheck } from 'lucide-react'
import { useEffect, useCallback, useState } from 'react'
import { StabilityTestPanel } from '@/components/dev/stability-test-panel'
import { CommandPalette } from '@/components/command-palette'
import { useAppIdleLock } from '@/hooks/use-app-idle-lock'
import { AppLockOverlay } from '@/components/layout/app-lock-overlay'
import { AppLockSetupDialog } from '@/components/layout/app-lock-setup-dialog'
import { useAuthStore } from '@/store/auth-store'
import { useSyncStore } from '@/store/sync-store'
import { sendStartupPulse } from '@/services/telemetry'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { OAuthCallbackLanding } from '@/components/auth/oauth-callback-landing'
import { useUpdaterStore } from '@/store/updater-store'
import { UpdateDialog } from '@/components/layout/update-dialog'
import { useToast } from '@/components/ui/toast'

function AppContent() {
  const { t } = useTranslation()
  const syncConnectionState = useAppStore((s) => s.syncConnectionState)
  const setServers = useAppStore((s) => s.setServers)
  const updateServer = useAppStore((s) => s.updateServer)
  const restoreWindowState = useAppStore((s) => s.restoreWindowState)
  const setKeys = useAppStore((s) => s.setKeys)
  const setServerGroups = useAppStore((s) => s.setServerGroups)
  const setTrashCount = useAppStore((s) => s.setTrashCount)
  const loadTagsStore = useAppStore((s) => s.loadTags)
  const hasActiveTab = useAppStore((s) => Boolean(s.activeTabId && s.tabs.some((t) => t.id === s.activeTabId)))
  useKeyboardShortcuts()
  useOverflowTitle()
  useAppIdleLock()

  // 应用锁配置弹窗状态（响应全局事件如 Ctrl+Alt+L 或标题栏设置）
  const [appLockSetupState, setAppLockSetupState] = useState<{
    open: boolean;
    mode: "setup" | "change" | "disable";
    lockImmediately: boolean;
  }>({
    open: false,
    mode: "setup",
    lockImmediately: false,
  })

  useEffect(() => {
    const handleOpenSetup = (e: Event) => {
      const customEvent = e as CustomEvent<{
        mode?: "setup" | "change" | "disable";
        lockImmediately?: boolean;
      }>;
      setAppLockSetupState({
        open: true,
        mode: customEvent.detail?.mode || "setup",
        lockImmediately: customEvent.detail?.lockImmediately ?? false,
      });
    };
    window.addEventListener("open-app-lock-setup", handleOpenSetup);
    return () => window.removeEventListener("open-app-lock-setup", handleOpenSetup);
  }, []);

  // 退出应用二次确认状态
  const [showExitConfirm, setShowExitConfirm] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  // 检测当前窗口是否为独立 OAuth 授权回调窗口 (label: 'qshell-oauth')
  const [isOAuthPopup, setIsOAuthPopup] = useState(false)

  // 已取消跨重启恢复工作台；清理开发版本可能留下的旧快照与 SFTP 未完成传输残留。
  const user = useAuthStore((s) => s.user)
  const { toast } = useToast()

  useEffect(() => {
    localStorage.removeItem('qshell-workspace-session-v1')
    localStorage.removeItem('sftp_pending_transfers')
    void useAuthStore.getState().init()
    void useSyncStore.getState().init().then(() => {
      void useSyncStore.getState().checkStartupSync()
    })
    void sendStartupPulse()

    if (isTauri) {
      void import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
        try {
          const win = getCurrentWebviewWindow()
          if (win.label === 'qshell-oauth') {
            setIsOAuthPopup(true)
            const handleOAuth = async () => {
              const { getSupabaseClient } = await import('@/lib/supabase')
              const client = getSupabaseClient()
              if (!client) return

              const finishLogin = async () => {
                try {
                  const { emit } = await import('@tauri-apps/api/event')
                  await emit('oauth-session-success')
                } catch {
                  /* ignore */
                }
                setTimeout(() => void win.close(), 400)
              }

              // 1. 尝试直接获取 Session
              const { data } = await client.auth.getSession()
              if (data.session) {
                await finishLogin()
                return
              }

              // 2. 尝试从 URL Hash 或 Search 提取 access_token / refresh_token
              const hashOrQuery = window.location.hash || window.location.search
              if (hashOrQuery.includes('access_token=')) {
                const params = new URLSearchParams(hashOrQuery.replace(/^[#?]/, ''))
                const accessToken = params.get('access_token')
                const refreshToken = params.get('refresh_token')
                if (accessToken) {
                  const { data: setRes } = await client.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken || '',
                  })
                  if (setRes.session) {
                    await finishLogin()
                    return
                  }
                }
              }

              // 3. 监听 onAuthStateChange 异步事件兜底
              const { data: listener } = client.auth.onAuthStateChange(async (_event, session) => {
                if (session) {
                  listener.subscription.unsubscribe()
                  await finishLogin()
                }
              })
            }
            void handleOAuth()
          }
        } catch {
          /* ignore */
        }
      })
    }
  }, [])

  useEffect(() => {
    if (!isTauri) return
    let unlisten: (() => void) | undefined
    let unlistenPayload: (() => void) | undefined
    void import('@tauri-apps/api/event').then(({ listen }) => {
      listen('oauth-session-success', () => {
        void useAuthStore.getState().init().then(() => {
          useAuthStore.getState().closeAuthDialog()
          toast.success('GitHub 账号登录成功，欢迎回来')
        })
      }).then((u) => {
        unlisten = u
      })

      listen<string>('oauth-session-payload', (event) => {
        if (event.payload) {
          void useAuthStore.getState().setSessionFromToken(event.payload).then(() => {
            useAuthStore.getState().closeAuthDialog()
            toast.success('授权令牌导入成功，已登录')
          })
        }
      }).then((u) => {
        unlistenPayload = u
      })
    })
    return () => {
      unlisten?.()
      unlistenPayload?.()
    }
  }, [toast])

  // 启动后静默检查更新（延迟 4 秒，避免和主界面初始化争抢网络资源）
  useEffect(() => {
    if (!isTauri) return
    const autoCheck = useUpdaterStore.getState().autoCheckOnStartup
    if (autoCheck) {
      const updateTimer = setTimeout(() => {
        void useUpdaterStore.getState().checkForUpdates(true)
      }, 4000)
      return () => clearTimeout(updateTimer)
    }
  }, [])

  // 监听窗口关闭事件：若有活跃传输正在进行，拦截并弹出二次确认弹窗
  useEffect(() => {
    if (!isTauri) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        if (sshService.hasActiveTransfers()) {
          e.preventDefault()
          e.returnValue = ''
        }
      }
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }

    let unlisten: (() => void) | undefined
    let isSubscribed = true

    try {
      getCurrentWebviewWindow().onCloseRequested(async (event) => {
        if (sshService.hasActiveTransfers()) {
          event.preventDefault()
          setShowExitConfirm(true)
        }
      }).then(fn => {
        if (isSubscribed) {
          unlisten = fn
        } else {
          fn()
        }
      }).catch(err => {
        console.warn('Failed to register onCloseRequested handler:', err)
      })
    } catch (err) {
      console.warn('getCurrentWebviewWindow error:', err)
    }

    return () => {
      isSubscribed = false
      unlisten?.()
    }
  }, [])

  // 确认退出应用：中止所有活跃传输、清理未完成临时文件后安全关闭窗口
  const handleConfirmExit = useCallback(async () => {
    setIsExiting(true)
    try {
      // 最多等待 3 秒执行远程临时文件清理，防止远端网络无响应时卡住退出
      await Promise.race([
        sshService.cancelAndCleanupAllTransfers(),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ])
    } catch (err) {
      console.error('Failed to cleanup transfers on exit:', err)
    }

    if (isTauri) {
      try {
        await getCurrentWebviewWindow().destroy()
      } catch (err) {
        console.error('Failed to destroy window on exit:', err)
        try {
          await getCurrentWebviewWindow().close()
        } catch (closeErr) {
          console.error('Failed to close window on exit:', closeErr)
          setIsExiting(false)
        }
      }
    } else {
      setShowExitConfirm(false)
      setIsExiting(false)
    }
  }, [])

  const isDesktop = sshService.isAvailable()

  // 从 URL 参数恢复窗口状态（外部通过 windowState 参数注入初始 tabs）
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const stateParam = params.get('windowState')
      if (stateParam) {
        // base64 URL-safe 解码（使用 TextDecoder 正确处理 UTF-8 多字节字符，如中文）
        const binary = atob(stateParam.replace(/-/g, '+').replace(/_/g, '/'))
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
        const json = new TextDecoder('utf-8').decode(bytes)
        const parsed = JSON.parse(json) as { tabs: WorkspaceTab[]; activeTabId: string | null }
        if (parsed.tabs && Array.isArray(parsed.tabs)) {
          restoreWindowState(parsed.tabs, parsed.activeTabId)
        }
      }
    } catch (e) {
      console.error('Failed to restore window state:', e)
    }
  }, [restoreWindowState])

  // 从 SQLite 加载服务器列表
  const loadServers = useCallback(async () => {
    try {
      const dbServers = await sshService.listServers()
      // sshService.listServers 已由适配层归一化（snake_case→camelCase、tags/protocols JSON 解析），
      // 此处不再白名单重建——旧写法会丢失 rdpPort/bmcPort/lastDisconnectedAt 等字段
      const normalizedServers = dbServers
      setServers(normalizedServers)
      // 同步回收站待删除数量
      try {
        const trash = await sshService.listTrashServers()
        setTrashCount(trash.length)
      } catch (e) {
        console.error('Failed to load trash count:', e)
      }

    } catch (e) {
      console.error('Failed to load servers:', e)
    }
  }, [setServers, setTrashCount])

  useEffect(() => {
    loadServers()
  }, [loadServers])

  // 从 SQLite 加载服务器分组（树形目录）
  const loadGroups = useCallback(async () => {
    try {
      const groups = await sshService.listGroups()
      setServerGroups(groups)
    } catch (e) {
      console.error('Failed to load server groups:', e)
    }
  }, [setServerGroups])

  useEffect(() => {
    loadGroups()
  }, [loadGroups])

  // 从后端加载标签目录（独立存储，空标签也会常驻下拉）
  const loadTags = useCallback(async () => {
    try {
      await loadTagsStore()
    } catch (e) {
      console.error('Failed to load tags:', e)
    }
  }, [loadTagsStore])

  useEffect(() => {
    loadTags()
  }, [loadTags])

  // 监听后端异步探测完成的 OS 类型与信息，实时更新 store 中的服务器图标与系统信息
  useEffect(() => {
    if (!isDesktop) return
    const unsubscribe = sshService.onOsDetected((data) => {
      updateServer(data.serverId, {
        osType: data.osType,
        osInfo: data.osInfo,
      })
    })
    return () => {
      unsubscribe()
    }
  }, [isDesktop, updateServer])

  // 从 SQLite 加载 SSH 密钥列表（passphrase / 私钥内容由后端加密存储，明文不返回前端）
  const loadKeys = useCallback(async () => {
    try {
      const dbKeys = await backend!.sshKeys.list()
      setKeys(dbKeys)
    } catch (e) {
      console.error('Failed to load ssh keys:', e)
    }
  }, [setKeys])

  // 首次启动迁移：旧版本将 SSH keys（含明文 passphrase）持久化到 localStorage，
  // 新版本已改为后端 SQLite 加密存储。这里把 localStorage 中残留的旧 keys
  // 一次性导入 SQLite，迁移完成后清除明文数据并设置标记位，避免重复执行。
  const migrateKeysFromLocalStorage = useCallback(async () => {
    const MIGRATION_FLAG = 'sw-ce-keys-migrated'
    const STORAGE_KEY = 'sw-ce-storage'
    if (localStorage.getItem(MIGRATION_FLAG)) return

    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        localStorage.setItem(MIGRATION_FLAG, '1')
        return
      }
      // localStorage 中旧版密钥的结构（字段可能全部缺失，故均可选）
      interface LegacySshKey {
        id?: string
        name?: string
        keyType?: string
        privateKeyPath?: string
        privateKeyPassphrase?: string
        publicKey?: string
        certificatePath?: string
        notes?: string
      }
      const parsed = JSON.parse(raw) as { state?: { keys?: LegacySshKey[] } }
      const legacyKeys = parsed?.state?.keys
      if (!Array.isArray(legacyKeys) || legacyKeys.length === 0) {
        localStorage.setItem(MIGRATION_FLAG, '1')
        return
      }

      console.log(`[Keys Migration] 检测到 ${legacyKeys.length} 个旧密钥，开始迁移到 SQLite...`)
      let successCount = 0
      let failCount = 0
      for (const oldKey of legacyKeys) {
        try {
          // 读取私钥文件内容（路径可能已失效，失败时仅入库路径不入库内容）
          let privateKeyContent: string | undefined
          if (oldKey.privateKeyPath) {
            try {
              privateKeyContent = await backend!.sshKeys.readFileContent(oldKey.privateKeyPath)
            } catch (e) {
              console.warn(`[Keys Migration] 密钥 "${oldKey.name}" 读取私钥文件失败（路径可能已失效）:`, e)
            }
          }
          // 读取证书文件内容
          let certificateContent: string | undefined
          if (oldKey.certificatePath) {
            try {
              certificateContent = await backend!.sshKeys.readFileContent(oldKey.certificatePath)
            } catch (e) {
              console.warn(`[Keys Migration] 密钥 "${oldKey.name}" 读取证书文件失败:`, e)
            }
          }
          const input: SshKeyInput = {
            id: oldKey.id || (window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now() + Math.random())),
            name: oldKey.name || '未命名密钥',
            keyType: oldKey.keyType === 'certificate' ? 'certificate' : 'private',
            privateKeyPath: oldKey.privateKeyPath || undefined,
            privateKeyContent,
            privateKeyPassphrase: oldKey.privateKeyPassphrase || undefined,
            publicKey: oldKey.publicKey || undefined,
            certificatePath: oldKey.certificatePath || undefined,
            certificateContent,
            notes: oldKey.notes || undefined,
          }
          await backend!.sshKeys.add(input)
          successCount++
        } catch (e) {
          console.error(`[Keys Migration] 密钥 "${oldKey.name}" 迁移失败:`, e)
          failCount++
        }
      }
      console.log(`[Keys Migration] 完成：成功 ${successCount}，失败 ${failCount}`)

      // 清除 localStorage 中的明文 keys 数据，避免 passphrase 泄漏
      if (parsed?.state) {
        delete parsed.state.keys
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
        } catch (e) {
          console.warn('[Keys Migration] 清除 localStorage keys 字段失败:', e)
        }
      }
    } catch (e) {
      console.error('[Keys Migration] 迁移流程异常:', e)
    } finally {
      // 无论成功失败都标记为已迁移，避免每次启动都重试（失败密钥需用户手动重建）
      localStorage.setItem(MIGRATION_FLAG, '1')
    }
  }, [])

  useEffect(() => {
    if (isDesktop) {
      // 先迁移旧数据，再加载 SQLite 中的密钥列表
      migrateKeysFromLocalStorage().finally(() => {
        loadKeys()
      })
    }
  }, [migrateKeysFromLocalStorage, loadKeys, isDesktop])

  // 全局异常与崩溃捕获，记录到应用日志
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const msg = `${event.message}\nAt: ${event.filename}:${event.lineno}:${event.colno}\nStack: ${event.error?.stack || ''}`
      if (backend) {
        backend.auditLogs.record('frontend', 'React Page', 'Frontend Runtime Error', 'failed', msg).catch(() => {})
      }
    }
    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = `Unhandled Promise Rejection: ${event.reason?.message || event.reason}\nStack: ${event.reason?.stack || ''}`
      if (backend) {
        backend.auditLogs.record('frontend', 'React Page', 'Frontend Async Promise Error', 'failed', msg).catch(() => {})
      }
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [])

  // 页面加载后检测所有服务器在线状态
  useEffect(() => {
    if (!isDesktop) return
    // 订阅探测进度事件：每完成一台探测就实时更新状态和统计
    const unsubscribe = sshService.onProbeProgress((data) => {
      updateServer(data.serverId, { status: data.online ? 'online' : 'offline' })
    })
    sshService.checkAllServers().then((results) => {
      // 兜底：确保所有探测结果都已应用（防止个别事件丢失）
      for (const [id, online] of Object.entries(results)) {
        updateServer(id, { status: online ? 'online' : 'offline' })
      }
    }).catch(() => {}).finally(() => {
      unsubscribe()
    })
  }, [updateServer, isDesktop])

  // 同步后端的 SSH 连接状态
  useEffect(() => {
    if (!isDesktop) return
    sshService.getConnectedServers().then((ids) => {
      if (ids && ids.length > 0) {
        syncConnectionState(ids)
      }
    }).catch(() => {})
  }, [isDesktop, syncConnectionState])

  // 当处于客户端内部的独立 OAuth 授权窗口 (qshell-oauth) 时，渲染轻量状态页并等待关闭
  if (isOAuthPopup) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground space-y-4 p-6 select-none">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center animate-pulse shadow-sm">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div className="space-y-1.5 text-center">
          <p className="text-sm font-semibold text-foreground">GitHub 授权已完成</p>
          <p className="text-xs text-muted-foreground">正在同步安全凭证并自动关闭窗口...</p>
        </div>
      </div>
    )
  }

  // 当在外部浏览器中运行且已完成登录或处于 OAuth 回调时，展示专属的授权完成页，不展示桌面工作台
  if (!isDesktop && (user || window.location.hash.includes('access_token'))) {
    return <OAuthCallbackLanding user={user} />
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background">
      {/* Non-desktop warning banner */}
      {!isDesktop && (
        <div className="flex items-center justify-between gap-2 px-4 py-1.5 bg-warning/10 border-b border-warning/20 text-warning text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              {t('app_not_desktop_prefix')}
              <code className="px-1 py-0.5 bg-warning/10 rounded font-mono">npm run dev:tauri</code>
              {t('app_not_desktop_suffix')}
            </span>
          </div>
          {user && (
            <button
              type="button"
              className="px-2 py-0.5 rounded bg-warning/20 hover:bg-warning/30 text-warning text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer shrink-0"
              onClick={() => {
                const token = localStorage.getItem('qshell_supabase_auth_token')
                if (token) {
                  navigator.clipboard.writeText(token)
                  toast.success('登录凭据已复制！切回桌面版 Qshell 点击导入即可秒级同步')
                } else {
                  toast.error('未找到本地登录凭据')
                }
              }}
            >
              <Copy className="h-3 w-3" />
              复制登录凭据同步到桌面端
            </button>
          )}
        </div>
      )}
      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main workspace (no sidebar) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <TabBar />

          {/* Content */}
          <div className="flex-1 overflow-hidden relative">
            {/* Dashboard - 无活跃标签时显示 */}
            <div className={!hasActiveTab ? 'h-full' : 'hidden'}>
              <Dashboard />
            </div>

            {/* 工作台区域：分屏布局树递归渲染。所有标签保持挂载，CSS 控制显隐以保持终端会话 */}
            <div className={hasActiveTab ? 'h-full' : 'hidden'}>
              <SplitLayoutView />
            </div>
          </div>

          {/* Status bar */}
          <StatusBar />
        </div>
      </div>

      {/* SSH 连接稳定性测试面板（Ctrl+Shift+T 打开） */}
      <StabilityTestPanel />

      {/* 全局命令面板（⌘K / Ctrl+K 打开） */}
      <CommandPalette />

      {/* 退出应用二次确认弹窗（存在活跃传输时拦截） */}
      <ConfirmDialog
        open={showExitConfirm}
        title={t('app_exit_transfer_confirm_title')}
        description={t('app_exit_transfer_confirm_desc')}
        confirmLabel={t('app_exit_transfer_confirm_btn')}
        cancelLabel={t('app_exit_transfer_cancel_btn')}
        variant="destructive"
        pending={isExiting}
        allowCancelWhilePending={true}
        onConfirm={handleConfirmExit}
        onCancel={() => {
          setShowExitConfirm(false)
          setIsExiting(false)
          window.dispatchEvent(new CustomEvent('focus-active-terminal'))
        }}
      />

      {/* 应用锁设置/修改/关闭弹窗 */}
      <AppLockSetupDialog
        open={appLockSetupState.open}
        mode={appLockSetupState.mode}
        lockImmediatelyOnSetup={appLockSetupState.lockImmediately}
        onClose={() => {
          setAppLockSetupState((s) => ({ ...s, open: false }))
          window.dispatchEvent(new CustomEvent('focus-active-terminal'))
        }}
      />

      {/* 应用级全屏离席防护遮罩 */}
      <AppLockOverlay />

      {/* 账号与云服务登录/注册弹窗 */}
      <AuthDialog />

      {/* 官方 OTA 软件自动更新弹窗 */}
      <UpdateDialog />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary>
          <ToastProvider>
            <TooltipProvider>
              <AppContent />
            </TooltipProvider>
          </ToastProvider>
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  )
}

export default App
