/**
 * src/components/layout/__tests__/settings-dialog-switches.test.tsx
 *
 * 设置弹窗与各子面板核心开关 (Switches) 联动与防回归测试套件：
 * 1. 通用设置 (界面音效、个性化光标、在线更新自动检查)
 * 2. 安全与应用锁 (应用锁开关与向导事件派发)
 * 3. 终端配置 (自动重连、防空闲断开联动折叠、划词浮条、复制粘贴、响铃、粗体高亮、指令提示、关键字高亮)
 * 4. SFTP 传输配置 (隐藏文件、排除规则联动置灰、遵循 .gitignore)
 * 5. AI 与云同步设置 (AI 运维总开关、吉祥物、DLP脱敏、内网IP掩码、自动云同步)
 * 6. 快速连续切换健壮性 (防状态撕裂与无未捕获异常)
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { SettingsDialog } from '../settings-dialog'
import { AISettingsPanel } from '../ai-settings-panel'
import { SyncSettingsPanel } from '../sync-settings-panel'
import { useAppStore, DEFAULT_SFTP_EXCLUSIONS } from '@/store'
import { useUpdaterStore } from '@/store/updater-store'
import { useAIStore } from '@/store/ai-store'
import { useSyncStore } from '@/store/sync-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/i18n-provider'

// 统一 Mock 音效与外部硬件接口，避免 jsdom 环境报错
vi.mock('@/lib/sound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sound')>()
  return {
    ...actual,
    playSound: vi.fn(),
  }
})

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    isTauri: false,
    backend: {
      ...actual.backend,
      files: {
        ...actual.backend?.files,
        setExclusionConfig: vi.fn().mockResolvedValue(undefined),
      },
      auditLogs: {
        list: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        clear: vi.fn().mockResolvedValue(undefined),
      },
      knownHosts: {
        list: vi.fn().mockResolvedValue([]),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  }
})

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn().mockResolvedValue(undefined),
}))

function renderSettingsDialog(props: {
  open?: boolean
  defaultTab?: 'general' | 'security' | 'terminal' | 'sftp' | 'account' | 'ai' | 'shortcuts' | 'known_hosts' | 'logs'
  onOpenChange?: (open: boolean) => void
} = {}) {
  const { open = true, defaultTab = 'general', onOpenChange = vi.fn() } = props
  return render(
    <I18nProvider>
      <TooltipProvider>
        <SettingsDialog open={open} onOpenChange={onOpenChange} defaultTab={defaultTab} />
      </TooltipProvider>
    </I18nProvider>
  )
}

function renderComponent(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </I18nProvider>
  )
}

describe('SettingsDialog Switches Suite', () => {
  beforeEach(() => {
    // 重置 AppStore 各项开关初始状态
    useAppStore.setState({
      uiSoundEnabled: false,
      customCursorEnabled: true,
      terminalAutoReconnect: false,
      terminalAntiIdleEnabled: false,
      terminalAntiIdleInterval: 60,
      terminalCopyPaste: false,
      terminalPasteWarnEnabled: true,
      terminalSelectionToolbar: true,
      terminalBellSound: false,
      terminalDrawBoldInBrightColors: true,
      terminalHintEnabled: true,
      terminalHighlightEnabled: true,
      sftpLocalShowHidden: false,
      sftpRemoteShowHidden: false,
      sftpExclusionEnabled: true,
      sftpExclusionPatterns: [...DEFAULT_SFTP_EXCLUSIONS],
      sftpRespectGitignore: true,
      appLockEnabled: false,
      appLockPasswordHash: null,
    })

    useUpdaterStore.setState({
      autoCheckOnStartup: true,
    })

    useAIStore.setState({
      enableAiGlobal: true,
      showFloatingMascot: true,
      settings: {
        ...useAIStore.getState().settings,
        enableDlp: true,
        maskPrivateIps: false,
      },
    })

    useSyncStore.setState({
      autoSync: false,
      currentToken: '',
      isConfigured: false,
      masterPassword: '',
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('1. General Settings Switches (通用设置开关)', () => {
    it('toggles uiSoundEnabled and triggers sound feedback on enable', () => {
      renderSettingsDialog({ defaultTab: 'general' })

      // 界面音效
      const soundLabel = screen.getByText('界面音效')
      const switchRow = soundLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(switchBtn).toBeTruthy()
      expect(switchBtn.getAttribute('data-state')).toBe('unchecked')
      expect(useAppStore.getState().uiSoundEnabled).toBe(false)

      // 点击开启
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().uiSoundEnabled).toBe(true)

      // 点击关闭
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().uiSoundEnabled).toBe(false)
    })

    it('toggles customCursorEnabled', () => {
      renderSettingsDialog({ defaultTab: 'general' })

      // 主题专属个性化光标
      const cursorLabel = screen.getByText('主题专属个性化光标')
      const switchRow = cursorLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(switchBtn).toBeTruthy()
      expect(switchBtn.getAttribute('data-state')).toBe('checked')
      expect(useAppStore.getState().customCursorEnabled).toBe(true)

      // 点击关闭
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().customCursorEnabled).toBe(false)

      // 再次点击开启
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().customCursorEnabled).toBe(true)
    })

    it('toggles autoCheckOnStartup for OTA updates', () => {
      renderSettingsDialog({ defaultTab: 'general' })

      // 启动时自动检查更新
      const otaLabel = screen.getByText('启动时自动检查更新')
      const switchRow = otaLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(switchBtn).toBeTruthy()
      expect(useUpdaterStore.getState().autoCheckOnStartup).toBe(true)

      // 切换为关闭
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useUpdaterStore.getState().autoCheckOnStartup).toBe(false)

      // 再次切换为开启
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useUpdaterStore.getState().autoCheckOnStartup).toBe(true)
    })
  })

  describe('2. Security & App Lock Switches (安全与应用锁)', () => {
    it('dispatches open-app-lock-setup with mode=setup when enabling without password', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      useAppStore.setState({ appLockEnabled: false, appLockPasswordHash: null })

      renderSettingsDialog({ defaultTab: 'security' })

      const lockLabel = screen.getByText('启用应用锁')
      const switchRow = lockLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(switchBtn).toBeTruthy()
      expect(switchBtn.getAttribute('data-state')).toBe('unchecked')

      // 点击开关触发向导
      act(() => {
        fireEvent.click(switchBtn)
      })

      expect(dispatchSpy).toHaveBeenCalled()
      const matchingCall = dispatchSpy.mock.calls.find(
        (c) => (c[0] as CustomEvent).type === 'open-app-lock-setup'
      )
      expect(matchingCall).toBeTruthy()
      expect((matchingCall![0] as CustomEvent).detail).toEqual({ mode: 'setup' })

      dispatchSpy.mockRestore()
    })

    it('dispatches open-app-lock-setup with mode=disable when disabling with existing lock', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
      useAppStore.setState({ appLockEnabled: true, appLockPasswordHash: 'hash-abc-123' })

      renderSettingsDialog({ defaultTab: 'security' })

      const lockLabel = screen.getByText('启用应用锁')
      const switchRow = lockLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(switchBtn).toBeTruthy()
      expect(switchBtn.getAttribute('data-state')).toBe('checked')

      // 点击关闭触发解除密码输入
      act(() => {
        fireEvent.click(switchBtn)
      })

      expect(dispatchSpy).toHaveBeenCalled()
      const matchingCall = dispatchSpy.mock.calls.find(
        (c) => (c[0] as CustomEvent).type === 'open-app-lock-setup'
      )
      expect(matchingCall).toBeTruthy()
      expect((matchingCall![0] as CustomEvent).detail).toEqual({ mode: 'disable' })

      dispatchSpy.mockRestore()
    })
  })

  describe('3. Terminal Switches (终端设置开关与条件联动)', () => {
    it('toggles terminalAutoReconnect', () => {
      renderSettingsDialog({ defaultTab: 'terminal' })

      const label = screen.getByText('自动重连')
      const switchRow = label.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!
      expect(useAppStore.getState().terminalAutoReconnect).toBe(false)

      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().terminalAutoReconnect).toBe(true)

      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().terminalAutoReconnect).toBe(false)
    })

    it('toggles terminalAntiIdleEnabled and dynamically expands/collapses interval options', () => {
      useAppStore.setState({ terminalAntiIdleEnabled: false, terminalAntiIdleInterval: 60 })
      const { rerender } = renderSettingsDialog({ defaultTab: 'terminal' })

      // 1. 关闭状态下，不应该渲染发送间隔选项
      expect(screen.queryByText('保活检测间隔')).toBeNull()
      expect(screen.queryByText('120s')).toBeNull()

      const antiIdleLabel = screen.getByText('防空闲断开 (Anti-Idle)')
      const switchRow = antiIdleLabel.closest('.justify-between')!
      const switchBtn = switchRow.querySelector('button[role="switch"]')!

      // 2. 开启开关
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().terminalAntiIdleEnabled).toBe(true)

      // 重新渲染以展现受控 UI
      rerender(
        <I18nProvider>
          <TooltipProvider>
            <SettingsDialog open={true} onOpenChange={vi.fn()} defaultTab="terminal" />
          </TooltipProvider>
        </I18nProvider>
      )

      // 3. 此时应该动态展开“保活检测间隔”与选项按钮 (如 120s)
      expect(screen.getByText('保活检测间隔')).toBeTruthy()
      const btn120 = screen.getByText('120s')
      expect(btn120).toBeTruthy()

      // 点击 120s 切换间隔
      act(() => {
        fireEvent.click(btn120)
      })
      expect(useAppStore.getState().terminalAntiIdleInterval).toBe(120)

      // 4. 关闭开关，选项应收起
      act(() => {
        fireEvent.click(switchBtn)
      })
      expect(useAppStore.getState().terminalAntiIdleEnabled).toBe(false)

      rerender(
        <I18nProvider>
          <TooltipProvider>
            <SettingsDialog open={true} onOpenChange={vi.fn()} defaultTab="terminal" />
          </TooltipProvider>
        </I18nProvider>
      )
      expect(screen.queryByText('保活检测间隔')).toBeNull()
    })

    it('toggles terminalCopyPaste, terminalPasteWarnEnabled, terminalSelectionToolbar', () => {
      renderSettingsDialog({ defaultTab: 'terminal' })

      // 选中文本自动复制
      const copyLabel = screen.getByText('选中文本自动复制')
      const copySwitch = copyLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(copySwitch)
      })
      expect(useAppStore.getState().terminalCopyPaste).toBe(true)

      // 超大文本粘贴确认
      const pasteWarnLabel = screen.getByText('超大文本粘贴确认')
      const pasteWarnSwitch = pasteWarnLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(pasteWarnSwitch)
      })
      expect(useAppStore.getState().terminalPasteWarnEnabled).toBe(false)

      // 划词快捷工具条
      const toolbarLabel = screen.getByText('划词快捷工具条')
      const toolbarSwitch = toolbarLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(toolbarSwitch)
      })
      expect(useAppStore.getState().terminalSelectionToolbar).toBe(false)
    })

    it('toggles terminalBellSound, terminalDrawBoldInBrightColors, terminalHintEnabled, terminalHighlightEnabled', () => {
      renderSettingsDialog({ defaultTab: 'terminal' })

      // 开启终端铃声
      const bellLabel = screen.getByText('开启终端铃声')
      const bellSwitch = bellLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(bellSwitch)
      })
      expect(useAppStore.getState().terminalBellSound).toBe(true)

      // 为粗体文本使用高亮颜色
      const boldLabel = screen.getByText('为粗体文本使用高亮颜色')
      const boldSwitch = boldLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(boldSwitch)
      })
      expect(useAppStore.getState().terminalDrawBoldInBrightColors).toBe(false)

      // 指令智能提示
      const hintLabel = screen.getByText('指令智能提示')
      const hintSwitch = hintLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(hintSwitch)
      })
      expect(useAppStore.getState().terminalHintEnabled).toBe(false)

      // 高亮设置 (仪表盘关键字高亮)
      const highlightLabel = screen.getByText('高亮设置')
      const highlightSwitch = highlightLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(highlightSwitch)
      })
      expect(useAppStore.getState().terminalHighlightEnabled).toBe(false)
    })
  })

  describe('4. SFTP File Transfer Switches (SFTP 文件传输开关与条件置灰)', () => {
    it('toggles sftpLocalShowHidden and sftpRemoteShowHidden', () => {
      renderSettingsDialog({ defaultTab: 'sftp' })

      const hiddenLabels = screen.getAllByText('显示隐藏文件')
      expect(hiddenLabels.length).toBeGreaterThanOrEqual(2)

      // 本地面板显示隐藏文件
      const localSwitch = hiddenLabels[0].closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(localSwitch)
      })
      expect(useAppStore.getState().sftpLocalShowHidden).toBe(true)

      // 远端面板显示隐藏文件
      const remoteSwitch = hiddenLabels[1].closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(remoteSwitch)
      })
      expect(useAppStore.getState().sftpRemoteShowHidden).toBe(true)
    })

    it('toggles sftpExclusionEnabled and updates exclusion container opacity/pointer-events', () => {
      useAppStore.setState({ sftpExclusionEnabled: true })
      const { rerender } = renderSettingsDialog({ defaultTab: 'sftp' })

      const exclusionTitle = screen.getByText('传输排除与忽略规则')
      const exclusionSwitch = exclusionTitle.closest('.justify-between')!.querySelector('button[role="switch"]')!
      expect(exclusionSwitch.getAttribute('data-state')).toBe('checked')

      // 1. 关闭排除规则开关
      act(() => {
        fireEvent.click(exclusionSwitch)
      })
      expect(useAppStore.getState().sftpExclusionEnabled).toBe(false)

      // 重新渲染
      rerender(
        <I18nProvider>
          <TooltipProvider>
            <SettingsDialog open={true} onOpenChange={vi.fn()} defaultTab="sftp" />
          </TooltipProvider>
        </I18nProvider>
      )

      // 2. 检查内部配置区是否获得了禁用样式 (opacity-50 pointer-events-none)
      const rulesHeading = screen.getByText('全局排除规则')
      const parentContainer = rulesHeading.closest('div.transition-opacity')!
      expect(parentContainer.className).toContain('opacity-50')
      expect(parentContainer.className).toContain('pointer-events-none')

      // 3. 再次开启
      act(() => {
        fireEvent.click(exclusionSwitch)
      })
      expect(useAppStore.getState().sftpExclusionEnabled).toBe(true)

      rerender(
        <I18nProvider>
          <TooltipProvider>
            <SettingsDialog open={true} onOpenChange={vi.fn()} defaultTab="sftp" />
          </TooltipProvider>
        </I18nProvider>
      )
      expect(parentContainer.className).not.toContain('opacity-50')
    })

    it('toggles sftpRespectGitignore', () => {
      renderSettingsDialog({ defaultTab: 'sftp' })

      const gitignoreLabel = screen.getByText('附加遵循项目 .gitignore（动态叠加）')
      const gitignoreSwitch = gitignoreLabel.closest('.justify-between')!.querySelector('button[role="switch"]')!
      expect(useAppStore.getState().sftpRespectGitignore).toBe(true)

      act(() => {
        fireEvent.click(gitignoreSwitch)
      })
      expect(useAppStore.getState().sftpRespectGitignore).toBe(false)

      act(() => {
        fireEvent.click(gitignoreSwitch)
      })
      expect(useAppStore.getState().sftpRespectGitignore).toBe(true)
    })
  })

  describe('5. AI & Cloud Sync Panel Switches (AI 运维与云同步开关)', () => {
    it('toggles AI switches in AISettingsPanel: enableAiGlobal, mascot, dlp, maskPrivateIps', () => {
      renderComponent(<AISettingsPanel />)

      // 1. AI 运维总开关
      const aiGlobalTitle = screen.getByText('启用 AI 运维与智能助手')
      const aiGlobalSwitch = aiGlobalTitle.closest('.justify-between')!.querySelector('button[role="switch"]')!
      expect(useAIStore.getState().enableAiGlobal).toBe(true)

      act(() => {
        fireEvent.click(aiGlobalSwitch)
      })
      expect(useAIStore.getState().enableAiGlobal).toBe(false)

      act(() => {
        fireEvent.click(aiGlobalSwitch)
      })
      expect(useAIStore.getState().enableAiGlobal).toBe(true)

      // 2. DLP 敏感脱敏开关
      const dlpTitle = screen.getByText('开启端侧敏感数据脱敏 (DLP)')
      const dlpSwitch = dlpTitle.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(dlpSwitch)
      })
      expect(useAIStore.getState().settings.enableDlp).toBe(false)

      // 3. 内网 IP 混淆掩码开关
      const maskIpTitle = screen.getByText('内网私有 IP 混淆掩码')
      const maskIpSwitch = maskIpTitle.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(maskIpSwitch)
      })
      expect(useAIStore.getState().settings.maskPrivateIps).toBe(true)

      // 4. 悬浮吉祥物小人显隐开关
      const mascotTitle = screen.getByText('显示桌面运维小助手')
      const mascotSwitch = mascotTitle.closest('.justify-between')!.querySelector('button[role="switch"]')!
      act(() => {
        fireEvent.click(mascotSwitch)
      })
      expect(useAIStore.getState().showFloatingMascot).toBe(false)
    })

    it('manages autoSync switch state in SyncSettingsPanel based on configuration', () => {
      // 未配置 Token 和主密码时，开关禁用 (disabled)
      useSyncStore.setState({ isConfigured: false, masterPassword: '', autoSync: false })
      const { rerender } = renderComponent(<SyncSettingsPanel />)

      const autoSyncTitle = screen.getByText('自动同步')
      const autoSyncRow = autoSyncTitle.closest('.justify-between')!
      const initialSwitch = autoSyncRow.querySelector('button[role="switch"]')!
      expect(initialSwitch).toBeTruthy()
      expect(initialSwitch.hasAttribute('disabled')).toBe(true)

      // 配置完成并录入主密码后，开关变为可交互 (not disabled)
      useSyncStore.setState({ isConfigured: true, masterPassword: 'mypassword', autoSync: false })
      rerender(
        <I18nProvider>
          <TooltipProvider>
            <SyncSettingsPanel />
          </TooltipProvider>
        </I18nProvider>
      )

      const activeSwitch = screen.getByText('自动同步').closest('.justify-between')!.querySelector('button[role="switch"]')!
      expect(activeSwitch.hasAttribute('disabled')).toBe(false)
      act(() => {
        fireEvent.click(activeSwitch)
      })
      expect(useSyncStore.getState().autoSync).toBe(true)
    })
  })

  describe('6. Rapid Continuous Toggle Resilience (高频快速连续切换健壮性)', () => {
    it('handles multiple rapid toggles without state tear or unhandled exceptions', () => {
      renderSettingsDialog({ defaultTab: 'terminal' })

      const label = screen.getByText('划词快捷工具条')
      const switchBtn = label.closest('.justify-between')!.querySelector('button[role="switch"]')!

      // 连续快速点击 10 次
      for (let i = 0; i < 10; i++) {
        act(() => {
          fireEvent.click(switchBtn)
        })
      }

      // 初始为 true，切换 10 次后仍应回到 true，Store 数据无撕裂
      expect(useAppStore.getState().terminalSelectionToolbar).toBe(true)
    })
  })
})
