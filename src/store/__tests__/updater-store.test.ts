import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUpdaterStore } from '../updater-store'

describe('useUpdaterStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useUpdaterStore.setState({
      isChecking: false,
      updateAvailable: false,
      updateInfo: null,
      isDownloading: false,
      downloadProgress: { downloaded: 0, total: 0, percentage: 0 },
      isReadyToRelaunch: false,
      errorMessage: null,
      isDialogOpen: false,
      autoCheckOnStartup: true,
      lastCheckedTime: null,
    })
  })

  it('initializes with default values', () => {
    const state = useUpdaterStore.getState()
    expect(state.isChecking).toBe(false)
    expect(state.updateAvailable).toBe(false)
    expect(state.updateInfo).toBeNull()
    expect(state.isDownloading).toBe(false)
    expect(state.autoCheckOnStartup).toBe(true)
  })

  it('opens and closes dialog', () => {
    const { openDialog, closeDialog } = useUpdaterStore.getState()
    openDialog()
    expect(useUpdaterStore.getState().isDialogOpen).toBe(true)

    closeDialog()
    expect(useUpdaterStore.getState().isDialogOpen).toBe(false)
  })

  it('updates autoCheckOnStartup and persists to localStorage', () => {
    const { setAutoCheckOnStartup } = useUpdaterStore.getState()
    setAutoCheckOnStartup(false)

    expect(useUpdaterStore.getState().autoCheckOnStartup).toBe(false)
    expect(localStorage.getItem('qshell_updater_auto_check')).toBe('false')

    setAutoCheckOnStartup(true)
    expect(useUpdaterStore.getState().autoCheckOnStartup).toBe(true)
    expect(localStorage.getItem('qshell_updater_auto_check')).toBe('true')
  })

  it('handles checkForUpdates in non-Tauri test environment gracefully', async () => {
    const { checkForUpdates } = useUpdaterStore.getState()
    const result = await checkForUpdates(false)

    expect(result).toBe(false)
    const state = useUpdaterStore.getState()
    expect(state.isChecking).toBe(false)
    expect(state.isDialogOpen).toBe(true)
    expect(state.errorMessage).toContain('桌面客户端')
  })

  it('handles downloadAndInstall when no update is available', async () => {
    const { downloadAndInstall } = useUpdaterStore.getState()
    await downloadAndInstall()

    expect(useUpdaterStore.getState().errorMessage).toBe('未找到可下载的更新包信息')
  })
})
