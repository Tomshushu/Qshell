/**
 * src/components/layout/__tests__/ai-settings-panel.test.tsx
 *
 * 验证 AI 设置面板 Option C 终端执行模式与自定义黑名单配置
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { AISettingsPanel } from '../ai-settings-panel'
import { useAIStore } from '@/store/ai-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/i18n-provider'

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </I18nProvider>
  )
}

describe('AISettingsPanel Option C Command Guard', () => {
  beforeEach(() => {
    useAIStore.setState({
      enableAiGlobal: true,
      settings: {
        provider: 'deepseek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2048,
        enableDlp: true,
        maskPrivateIps: false,
        executionMode: 'ask',
        customBlacklist: ['prod-db'],
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Option C command guard title, highlights and 3 execution modes', () => {
    renderWithProviders(<AISettingsPanel />)

    expect(screen.getByText('AI 终端安全执行与只读白名单网关')).toBeTruthy()
    expect(screen.getByText('Option C 智能受控')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-ask')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-auto-readonly')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-disabled')).toBeTruthy()
  })

  it('allows user to switch execution modes', () => {
    renderWithProviders(<AISettingsPanel />)

    // 默认是 ask
    expect(useAIStore.getState().settings.executionMode).toBe('ask')

    // 切换到 auto_readonly
    act(() => {
      fireEvent.click(screen.getByTestId('exec-mode-auto-readonly'))
    })
    expect(useAIStore.getState().settings.executionMode).toBe('auto_readonly')

    // 切换到 disabled
    act(() => {
      fireEvent.click(screen.getByTestId('exec-mode-disabled'))
    })
    expect(useAIStore.getState().settings.executionMode).toBe('disabled')
  })

  it('allows user to add and remove custom blacklist items', () => {
    renderWithProviders(<AISettingsPanel />)

    // 检查已有的 prod-db
    expect(screen.getByTestId('blacklist-tag-prod-db')).toBeTruthy()

    // 添加新关键词
    const input = screen.getByTestId('custom-blacklist-input')
    const addBtn = screen.getByTestId('custom-blacklist-add-btn')

    act(() => {
      fireEvent.change(input, { target: { value: 'truncate, drop' } })
    })

    act(() => {
      fireEvent.click(addBtn)
    })

    const updatedList = useAIStore.getState().settings.customBlacklist
    expect(updatedList).toContain('prod-db')
    expect(updatedList).toContain('truncate')
    expect(updatedList).toContain('drop')

    // 删除 prod-db
    const prodDbTag = screen.getByTestId('blacklist-tag-prod-db')
    const removeBtn = prodDbTag.querySelector('button')
    expect(removeBtn).toBeTruthy()

    act(() => {
      fireEvent.click(removeBtn!)
    })

    const finalAfterRemoval = useAIStore.getState().settings.customBlacklist
    expect(finalAfterRemoval).not.toContain('prod-db')
    expect(finalAfterRemoval).toContain('truncate')
  })
})
