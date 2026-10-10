import { create } from 'zustand'
import { isTauri } from '@/services/api'
import type { Update, DownloadEvent } from '@tauri-apps/plugin-updater'

const AUTO_CHECK_STORAGE_KEY = 'qshell_updater_auto_check'

export interface UpdateInfo {
  version: string
  currentVersion: string
  date?: string
  body?: string
}

export interface UpdaterState {
  isChecking: boolean
  updateAvailable: boolean
  updateInfo: UpdateInfo | null
  isDownloading: boolean
  downloadProgress: {
    downloaded: number
    total: number
    percentage: number
  }
  isReadyToRelaunch: boolean
  errorMessage: string | null
  isDialogOpen: boolean
  autoCheckOnStartup: boolean
  lastCheckedTime: number | null

  // 方法
  openDialog: () => void
  closeDialog: () => void
  checkForUpdates: (silent?: boolean) => Promise<boolean>
  downloadAndInstall: () => Promise<void>
  relaunchApp: () => Promise<void>
  setAutoCheckOnStartup: (enabled: boolean) => void
}

let activeUpdate: Update | null = null

export const useUpdaterStore = create<UpdaterState>((set, get) => {
  // 从 localStorage 恢复是否自动检查更新配置（默认 true）
  let initialAutoCheck = true
  try {
    const saved = localStorage.getItem(AUTO_CHECK_STORAGE_KEY)
    if (saved !== null) {
      initialAutoCheck = saved === 'true'
    }
  } catch {
    /* ignore localStorage errors */
  }

  return {
    isChecking: false,
    updateAvailable: false,
    updateInfo: null,
    isDownloading: false,
    downloadProgress: {
      downloaded: 0,
      total: 0,
      percentage: 0,
    },
    isReadyToRelaunch: false,
    errorMessage: null,
    isDialogOpen: false,
    autoCheckOnStartup: initialAutoCheck,
    lastCheckedTime: null,

    openDialog: () => set({ isDialogOpen: true }),
    closeDialog: () => set({ isDialogOpen: false }),

    setAutoCheckOnStartup: (enabled: boolean) => {
      try {
        localStorage.setItem(AUTO_CHECK_STORAGE_KEY, String(enabled))
      } catch {
        /* ignore */
      }
      set({ autoCheckOnStartup: enabled })
    },

    checkForUpdates: async (silent = false) => {
      if (!isTauri) {
        if (!silent) {
          set({
            errorMessage: '在线自动更新功能仅在桌面客户端下可用',
            isChecking: false,
            isDialogOpen: true,
          })
        }
        return false
      }

      set({ isChecking: true, errorMessage: null, isReadyToRelaunch: false })

      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check({ timeout: 15000 })

        if (update) {
          activeUpdate = update
          set({
            isChecking: false,
            updateAvailable: true,
            updateInfo: {
              version: update.version,
              currentVersion: update.currentVersion,
              date: update.date,
              body: update.body,
            },
            isDialogOpen: true,
            lastCheckedTime: Date.now(),
          })
          return true
        } else {
          // 清空旧的更新对象
          if (activeUpdate) {
            try {
              await activeUpdate.close()
            } catch {
              /* ignore */
            }
            activeUpdate = null
          }

          set({
            isChecking: false,
            updateAvailable: false,
            updateInfo: null,
            lastCheckedTime: Date.now(),
          })
          if (!silent) {
            set({ isDialogOpen: true })
          }
          return false
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : String(err)
        console.warn('[Updater] Check failed:', rawMsg)

        let friendlyMsg = rawMsg
        if (rawMsg.includes('None of the fallback platforms')) {
          friendlyMsg = '更新清单中未配置当前平台的安装包条目，请稍后重试。'
        } else if (
          rawMsg.includes('error sending request') ||
          rawMsg.includes('connection') ||
          rawMsg.includes('handshake') ||
          rawMsg.includes('timed out') ||
          rawMsg.includes('dns')
        ) {
          friendlyMsg = `无法连接到更新服务器，请检查网络连接或系统代理设置后重试。\n（详细错误：${rawMsg}）`
        }

        set({
          isChecking: false,
          errorMessage: friendlyMsg,
          lastCheckedTime: Date.now(),
        })
        if (!silent) {
          set({ isDialogOpen: true })
        }
        return false
      }
    },

    downloadAndInstall: async () => {
      if (!activeUpdate) {
        set({ errorMessage: '未找到可下载的更新包信息' })
        return
      }

      set({
        isDownloading: true,
        errorMessage: null,
        downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
      })

      try {
        let totalBytes = 0
        let downloadedBytes = 0

        await activeUpdate.downloadAndInstall((event: DownloadEvent) => {
          if (event.event === 'Started') {
            totalBytes = event.data.contentLength ?? 0
            set({
              downloadProgress: {
                downloaded: 0,
                total: totalBytes,
                percentage: 0,
              },
            })
          } else if (event.event === 'Progress') {
            downloadedBytes += event.data.chunkLength
            const percentage =
              totalBytes > 0
                ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                : 0
            set({
              downloadProgress: {
                downloaded: downloadedBytes,
                total: totalBytes,
                percentage,
              },
            })
          } else if (event.event === 'Finished') {
            set({
              downloadProgress: {
                downloaded: totalBytes || downloadedBytes,
                total: totalBytes || downloadedBytes,
                percentage: 100,
              },
            })
          }
        })

        // 在部分平台（如 macOS/Linux），需用户确认后手动调用 relaunchApp
        // 在 Windows 上，downloadAndInstall 通常已自动拉起静默安装包
        set({
          isDownloading: false,
          isReadyToRelaunch: true,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Updater] Download & install failed:', msg)
        set({
          isDownloading: false,
          errorMessage: `下载安装失败: ${msg}`,
        })
      }
    },

    relaunchApp: async () => {
      try {
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      } catch (err: unknown) {
        console.error('[Updater] Relaunch failed:', err)
      }
    },
  }
})
