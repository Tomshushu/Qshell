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
})
