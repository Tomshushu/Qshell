import { describe, it, expect, beforeEach } from 'vitest'
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

  it('correctly compares semantic versions via isVersionNewer', async () => {
    const { isVersionNewer } = await import('../updater-store')
    expect(isVersionNewer('1.0.3', '1.0.2')).toBe(true)
    expect(isVersionNewer('v1.0.3', '1.0.2')).toBe(true)
    expect(isVersionNewer('1.1.0', '1.0.9')).toBe(true)
    expect(isVersionNewer('2.0.0', '1.9.9')).toBe(true)
    expect(isVersionNewer('1.0.2', '1.0.2')).toBe(false)
    expect(isVersionNewer('1.0.1', '1.0.2')).toBe(false)
    expect(isVersionNewer('', '1.0.2')).toBe(false)
  })

  it('updates skippedVersion and persists to localStorage on skipVersion', () => {
    const { skipVersion, openDialog } = useUpdaterStore.getState()
    openDialog()
    expect(useUpdaterStore.getState().isDialogOpen).toBe(true)

    skipVersion('1.0.2')
    expect(useUpdaterStore.getState().skippedVersion).toBe('1.0.2')
    expect(useUpdaterStore.getState().isDialogOpen).toBe(false)
    expect(localStorage.getItem('qshell_updater_skipped_version')).toBe('1.0.2')

    const { resetSkippedVersion } = useUpdaterStore.getState()
    resetSkippedVersion()
    expect(useUpdaterStore.getState().skippedVersion).toBeNull()
    expect(localStorage.getItem('qshell_updater_skipped_version')).toBeNull()
  })

  it('updates preferredMirror and persists to localStorage', () => {
    const { setPreferredMirror } = useUpdaterStore.getState()
    expect(useUpdaterStore.getState().preferredMirror).toBe('auto')

    setPreferredMirror('gitee')
    expect(useUpdaterStore.getState().preferredMirror).toBe('gitee')
    expect(localStorage.getItem('qshell_updater_preferred_mirror')).toBe('gitee')

    setPreferredMirror('github')
    expect(useUpdaterStore.getState().preferredMirror).toBe('github')
    expect(localStorage.getItem('qshell_updater_preferred_mirror')).toBe('github')

    setPreferredMirror('auto')
    expect(useUpdaterStore.getState().preferredMirror).toBe('auto')
    expect(localStorage.getItem('qshell_updater_preferred_mirror')).toBe('auto')
  })

  it('handles probeMirrors gracefully in non-Tauri environment', async () => {
    const { probeMirrors } = useUpdaterStore.getState()
    const result = await probeMirrors()
    expect(result).toBeNull()
    expect(useUpdaterStore.getState().isProbing).toBe(false)
  })
})
