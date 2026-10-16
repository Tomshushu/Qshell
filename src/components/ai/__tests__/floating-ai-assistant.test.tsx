/**
 * src/components/ai/__tests__/floating-ai-assistant.test.tsx
 *
 * 全局悬浮 AI 助手组件与 Mascot 吉祥物单元测试
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { AIMascotAvatar } from '../ai-mascot-avatar'
import { FloatingAIAssistant } from '../floating-ai-assistant'
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

describe('AIMascotAvatar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders SVG with custom size and elements', () => {
    const { container } = render(
      <AIMascotAvatar size={64} mood="idle" showGlowRing={true} />
    )
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect((container.firstChild as HTMLElement).style.width).toBe('64px')
    expect((container.firstChild as HTMLElement).style.height).toBe('64px')
  })

  it('renders happy mood smiling eyes', () => {
    const { container } = render(
      <AIMascotAvatar size={48} mood="happy" showGlowRing={false} />
    )
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('renders thinking mood pulsing dots', () => {
    const { container } = render(
      <AIMascotAvatar size={48} mood="thinking" showGlowRing={false} />
    )
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThan(0)
  })
})

describe('FloatingAIAssistant Component & Store Flow', () => {
  beforeEach(() => {
    useAIStore.setState({
      showFloatingMascot: true,
      isFloatingAssistantOpen: false,
      assistantMessages: [],
      assistantInput: '',
      assistantMode: 'agent',
      assistantMascotMood: 'idle',
      isAssistantResponding: false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders floating mascot trigger button by default', () => {
    renderWithProviders(<FloatingAIAssistant />)
    const mascot = document.querySelector('svg')
    expect(mascot).toBeTruthy()
  })

  it('does not render when showFloatingMascot is false', () => {
    useAIStore.setState({ showFloatingMascot: false })
    const { container } = renderWithProviders(<FloatingAIAssistant />)
    expect(container.firstChild).toBeNull()
  })

  it('toggles assistant open state when clicked', () => {
    renderWithProviders(<FloatingAIAssistant />)
    act(() => {
      useAIStore.getState().openFloatingAssistant()
    })
    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)
  })

  it('renders welcome cards and prompt pills when conversation is empty', () => {
    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)
    expect(screen.getByText('您好，欢迎使用')).toBeTruthy()
    expect(screen.getByText('异常诊断')).toBeTruthy()
    expect(screen.getByText('操作运维')).toBeTruthy()
    expect(screen.getByText('监控分析')).toBeTruthy()
    expect(screen.getByText('服务部署')).toBeTruthy()
    expect(screen.getByText('资源查询')).toBeTruthy()
    expect(screen.getByText('方案建议')).toBeTruthy()
  })

  it('allows switching between Agent and Chat modes', () => {
    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const chatButton = screen.getByRole('button', { name: /Chat/i })
    act(() => {
      fireEvent.click(chatButton)
    })
    expect(useAIStore.getState().assistantMode).toBe('chat')

    const agentButton = screen.getByRole('button', { name: /Agent/i })
    act(() => {
      fireEvent.click(agentButton)
    })
    expect(useAIStore.getState().assistantMode).toBe('agent')
  })

  it('sends user message and receives structured assistant response in store', async () => {
    vi.useFakeTimers()
    const { sendAssistantMessage } = useAIStore.getState()

    await act(async () => {
      const promise = sendAssistantMessage('SSH 连接超时怎么办？')
      vi.runAllTimers()
      await promise
    })

    const messages = useAIStore.getState().assistantMessages
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('SSH 连接超时怎么办？')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toContain('SSH 连接超时排查指南')
    expect(messages[1].suggestedCommands?.length).toBeGreaterThan(0)

    vi.useRealTimers()
  })

  it('supports dragging the mascot button across the screen (right/bottom offset)', () => {
    renderWithProviders(<FloatingAIAssistant />)
    const trigger = screen.getByTestId('ai-mascot-trigger')
    expect(trigger).toBeTruthy()

    // Simulate drag gesture
    fireEvent.pointerDown(trigger, { clientX: 100, clientY: 100, button: 0 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 250 })
    fireEvent.pointerUp(window)

    // The trigger position was updated using right and bottom
    expect(trigger.style.right).toBeDefined()
    expect(trigger.style.bottom).toBeDefined()
  })

  it('supports dragging the dialog card by its header', () => {
    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)
    const dialog = screen.getByTestId('ai-assistant-dialog')
    expect(dialog).toBeTruthy()

    // Header has drag listener
    const header = dialog.firstElementChild as HTMLElement
    expect(header).toBeTruthy()

    fireEvent.pointerDown(header, { clientX: 300, clientY: 200, button: 0 })
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 })
    fireEvent.pointerUp(window)

    expect(dialog.style.left).toBeDefined()
    expect(dialog.style.top).toBeDefined()
  })

  it('does not render when enableAiGlobal is false', () => {
    useAIStore.setState({ enableAiGlobal: false })
    const { container } = renderWithProviders(<FloatingAIAssistant />)
    expect(container.firstChild).toBeNull()
  })

  it('renders offline mode banner when no AI provider is configured and fires open-settings', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      configuredProviders: [],
      settings: { ...useAIStore.getState().settings, apiKey: '' },
    })

    renderWithProviders(<FloatingAIAssistant />)
    expect(screen.getByText(/当前处于本地离线规则模式/)).toBeTruthy()

    const configButton = screen.getByRole('button', { name: /去配置/i })
    fireEvent.click(configButton)

    expect(dispatchSpy).toHaveBeenCalled()
    const matchingCall = dispatchSpy.mock.calls.find(
      (c) => (c[0] as CustomEvent).type === 'open-settings'
    )
    expect(matchingCall).toBeTruthy()
    expect((matchingCall![0] as CustomEvent).detail).toBe('ai')

    dispatchSpy.mockRestore()
  })

  it('opens assistant and performs diagnosis in-chat when openDiagnosis is called', async () => {
    vi.useFakeTimers()
    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: false,
      assistantMessages: [],
    })

    await act(async () => {
      useAIStore.getState().openDiagnosis('Error: Connection refused on port 22')
      vi.runAllTimers()
    })

    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)
    const messages = useAIStore.getState().assistantMessages
    expect(messages.length).toBeGreaterThanOrEqual(1)
    expect(messages[0].content).toContain('Error: Connection refused on port 22')

    vi.useRealTimers()
  })

  it('supports maximizing to right 1/3 screen width with full window height and restoring', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1800 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 1000 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    expect(dialog).toBeTruthy()

    expect(dialog.style.width).toBe('420px')
    expect(dialog.style.height).toBe('600px')

    const maxBtn = screen.getByTestId('ai-maximize-toggle-btn')
    expect(maxBtn).toBeTruthy()

    // Click to maximize
    act(() => {
      fireEvent.click(maxBtn)
    })

    // 1/3 of 1800 is 600px. Height occupies full window (1000 - 32 = 968px).
    // Position x = 1800 - 600 - 16 = 1184px, y = 16px.
    expect(dialog.style.width).toBe('600px')
    expect(dialog.style.height).toBe('968px')
    expect(dialog.style.left).toBe('1184px')
    expect(dialog.style.top).toBe('16px')

    // Click to restore
    act(() => {
      fireEvent.click(maxBtn)
    })

    expect(dialog.style.width).toBe('420px')
    expect(dialog.style.height).toBe('600px')
  })

  it('supports maximizing in standard 1000x800 window where height expands to fill window', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    const maxBtn = screen.getByTestId('ai-maximize-toggle-btn')

    act(() => {
      fireEvent.click(maxBtn)
    })

    // Width = Math.max(380, Math.floor(1000 / 3)) = 380px.
    // Height = 800 - 32 = 768px.
    // Position x = 1000 - 380 - 16 = 604px, y = 16px.
    expect(dialog.style.width).toBe('380px')
    expect(dialog.style.height).toBe('768px')
    expect(dialog.style.left).toBe('604px')
    expect(dialog.style.top).toBe('16px')
  })

  it('supports toggling maximize via double clicking header', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1800 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 1000 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    const header = dialog.firstElementChild as HTMLElement
    expect(header).toBeTruthy()

    // Double click header to maximize
    act(() => {
      fireEvent.doubleClick(header)
    })

    expect(dialog.style.width).toBe('600px')
    expect(dialog.style.height).toBe('968px')

    // Double click header again to restore
    act(() => {
      fireEvent.doubleClick(header)
    })

    expect(dialog.style.width).toBe('420px')
    expect(dialog.style.height).toBe('600px')
  })
})

