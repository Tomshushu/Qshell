/**
 * src/components/ai/__tests__/floating-ai-assistant.test.tsx
 *
 * 全局悬浮 AI 助手组件与 Mascot 吉祥物单元测试
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { AIMascotAvatar } from '../ai-mascot-avatar'
import { FloatingAIAssistant, parseThinkingAndContent } from '../floating-ai-assistant'
import { useAIStore } from '@/store/ai-store'
import { useAppStore } from '@/store'
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
    vi.useRealTimers()
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
    expect(screen.getByText('巡检所有服务器')).toBeTruthy()
    expect(screen.getByText('高占用排查')).toBeTruthy()
    expect(screen.getByText('大文件排查')).toBeTruthy()
    expect(screen.getByText('端口与网络')).toBeTruthy()
    expect(screen.getByText('容器与服务')).toBeTruthy()
    expect(screen.getByText('脚本与调优')).toBeTruthy()
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
      await vi.runAllTimersAsync()
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

  it('strictly restricts mascot dragging within content area and status bar, and supports double click reset', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 })

    renderWithProviders(<FloatingAIAssistant />)
    const trigger = screen.getByTestId('ai-mascot-trigger')

    // 尝试向上拖出屏幕到顶栏 (CONTENT_TOP_OFFSET = 88px)
    fireEvent.pointerDown(trigger, { clientX: 900, clientY: 700, button: 0 })
    fireEvent.pointerMove(window, { clientX: 900, clientY: -200 })
    fireEvent.pointerUp(window)

    // top 永远 >= 96px (高出 CONTENT_TOP_OFFSET 88px)，绝不遮挡顶栏 TabBar、模块工具栏和 Tomshuru 用户信息
    const topDistance = 800 - parseInt(trigger.style.bottom, 10) - 44
    expect(topDistance).toBeGreaterThanOrEqual(96)

    // 双击重置回默认位置
    fireEvent.doubleClick(trigger)
    expect(trigger.style.right).toBe('28px')
    expect(trigger.style.bottom).toBe('48px')
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

  it('supports dragging width and height freely without 1/3 limitation, strictly bound to content area and status bar', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1800 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 1000 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    expect(dialog).toBeTruthy()

    // 默认尺寸：420px x 600px
    expect(dialog.style.width).toBe('420px')
    expect(dialog.style.height).toBe('600px')

    // 验证不存在最大化按钮
    expect(screen.queryByTestId('ai-maximize-toggle-btn')).toBeNull()

    // 通过右下角拉伸把手调整大小 (宽拉伸到 750px，高尝试拉到 1200px)
    const seGrip = screen.getByTestId('ai-resize-se')
    expect(seGrip).toBeTruthy()

    act(() => {
      fireEvent.pointerDown(seGrip, { clientX: 500, clientY: 500, button: 0 })
      // dx = +330 (420 + 330 = 750px), dy = +500 (超出了视口可用高度)
      fireEvent.pointerMove(window, { clientX: 830, clientY: 1000 })
      fireEvent.pointerUp(window)
    })

    // 宽展开至 750px（彻底脱离原 1/3 屏幕与 420:600 固定长宽比限制）
    expect(dialog.style.width).toBe('750px')
    // 高度严格限制在主内容区 (88px) 与页脚 (32px) 之间：1000 - 88 - 32 = 880px，绝不穿透页脚
    expect(parseInt(dialog.style.height, 10)).toBeLessThanOrEqual(880)
  })

  it('supports dragging edge handles (n, s, e, w) to adjust dimensions with position adjustments and top limit', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 800 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')

    // 1. 东侧右拉伸把手增加宽度
    const eHandle = screen.getByTestId('ai-resize-e')
    act(() => {
      fireEvent.pointerDown(eHandle, { clientX: 400, clientY: 200, button: 0 })
      fireEvent.pointerMove(window, { clientX: 480, clientY: 200 })
      fireEvent.pointerUp(window)
    })
    expect(dialog.style.width).toBe('500px') // 420 + 80 = 500px

    // 2. 北侧上拉伸把手向上拉伸高度，验证 top 坐标与高度受 CONTENT_TOP_OFFSET (88px) 限制
    const nHandle = screen.getByTestId('ai-resize-n')
    act(() => {
      fireEvent.pointerDown(nHandle, { clientX: 300, clientY: 200, button: 0 })
      fireEvent.pointerMove(window, { clientX: 300, clientY: 0 }) // 尝试拉出屏幕顶部
      fireEvent.pointerUp(window)
    })
    // 顶部 top 绝不小于 88px
    expect(parseInt(dialog.style.top, 10)).toBeGreaterThanOrEqual(88)

    // 3. 南侧下拉伸把手向下拉伸，验证底部绝不越过页脚
    const sHandle = screen.getByTestId('ai-resize-s')
    act(() => {
      fireEvent.pointerDown(sHandle, { clientX: 300, clientY: 400, button: 0 })
      fireEvent.pointerMove(window, { clientX: 300, clientY: 900 }) // 尝试拉出屏幕底部
      fireEvent.pointerUp(window)
    })
    // top + height 绝不大于 800 - 32 = 768px
    const finalTop = parseInt(dialog.style.top, 10)
    const finalH = parseInt(dialog.style.height, 10)
    expect(finalTop + finalH).toBeLessThanOrEqual(768)
  })

  it('supports dragging the resized dialog by header while staying within vertical bounds', () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1800 })
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: 1000 })

    useAIStore.setState({ isFloatingAssistantOpen: true })
    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    const header = dialog.firstElementChild as HTMLElement

    // 向上拖动超过顶部
    act(() => {
      fireEvent.pointerDown(header, { clientX: 500, clientY: 200, button: 0 })
      fireEvent.pointerMove(window, { clientX: 500, clientY: -100 })
      fireEvent.pointerUp(window)
    })

    // 顶部位置绝不小于 88px (主内容区上限)
    expect(parseInt(dialog.style.top, 10)).toBe(88)

    // 向下拖动到底部页脚
    act(() => {
      fireEvent.pointerDown(header, { clientX: 500, clientY: 88, button: 0 })
      fireEvent.pointerMove(window, { clientX: 500, clientY: 1000 })
      fireEvent.pointerUp(window)
    })

    // top + height 绝不大于 1000 - 32 = 968px
    const top = parseInt(dialog.style.top, 10)
    const height = parseInt(dialog.style.height, 10)
    expect(top + height).toBeLessThanOrEqual(968)
  })

  it('resets dialog position to initial position when exiting via close button (×) or clicking assistant mascot icon', () => {
    useAIStore.setState({ isFloatingAssistantOpen: true })
    const { rerender } = renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    const header = dialog.firstElementChild as HTMLElement

    // 1. 拖拽卡片到自定义位置
    act(() => {
      fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 })
      fireEvent.pointerMove(window, { clientX: 300, clientY: 300 })
      fireEvent.pointerUp(window)
    })

    // 2. 点击右上角 "×" 关闭按钮退出
    const closeBtn = screen.getByTestId('ai-dialog-close-btn')
    expect(closeBtn).toBeTruthy()
    act(() => {
      fireEvent.click(closeBtn)
    })

    // 验证状态已关闭
    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(false)

    // 3. 点击小人图标重新打开
    const mascotTrigger = screen.getByTestId('ai-mascot-trigger')
    act(() => {
      fireEvent.pointerDown(mascotTrigger, { clientX: 500, clientY: 500, button: 0 })
      fireEvent.pointerUp(window)
    })

    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)

    rerender(
      <I18nProvider>
        <TooltipProvider>
          <FloatingAIAssistant />
        </TooltipProvider>
      </I18nProvider>
    )

    // 验证卡片已重置回初始默认尺寸与位置
    const reopenedDialog1 = screen.getByTestId('ai-assistant-dialog')
    expect(reopenedDialog1).toBeTruthy()
    expect(reopenedDialog1.style.width).toBe('420px')
    expect(reopenedDialog1.style.height).toBe('600px')

    // 4. 再次拖拽卡片
    const header2 = reopenedDialog1.firstElementChild as HTMLElement
    act(() => {
      fireEvent.pointerDown(header2, { clientX: 100, clientY: 100, button: 0 })
      fireEvent.pointerMove(window, { clientX: 450, clientY: 450 })
      fireEvent.pointerUp(window)
    })

    // 5. 点击小人图标退出 (再次点击小人吉祥物收起卡片)
    act(() => {
      fireEvent.pointerDown(mascotTrigger, { clientX: 500, clientY: 500, button: 0 })
      fireEvent.pointerUp(window)
    })

    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(false)

    // 6. 再次点击小人图标打开，验证位置同样已彻底重置
    act(() => {
      fireEvent.pointerDown(mascotTrigger, { clientX: 500, clientY: 500, button: 0 })
      fireEvent.pointerUp(window)
    })

    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)

    rerender(
      <I18nProvider>
        <TooltipProvider>
          <FloatingAIAssistant />
        </TooltipProvider>
      </I18nProvider>
    )

    const reopenedDialog2 = screen.getByTestId('ai-assistant-dialog')
    expect(reopenedDialog2).toBeTruthy()
    expect(reopenedDialog2.style.width).toBe('420px')
    expect(reopenedDialog2.style.height).toBe('600px')
  })

  it('toggles session history panel and displays stored sessions', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantSessions: [
        {
          id: 'session-1',
          title: '排查 CPU 负载过高',
          messages: [
            { id: '1', role: 'user', content: '排查 CPU 负载过高', createdAt: Date.now(), mode: 'agent' },
            { id: '2', role: 'assistant', content: '已生成 top 和 htop 命令', createdAt: Date.now(), mode: 'agent' },
          ],
          createdAt: Date.now() - 60000,
          updatedAt: Date.now() - 60000,
          mode: 'agent',
        },
      ],
      currentAssistantSessionId: 'session-1',
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Initially history panel is closed
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()

    // Click history button
    const historyBtn = screen.getByTestId('ai-history-toggle-btn')
    act(() => {
      fireEvent.click(historyBtn)
    })

    // Panel is opened
    expect(screen.getByTestId('ai-history-panel')).toBeTruthy()
    expect(screen.getByText('排查 CPU 负载过高')).toBeTruthy()
    expect(screen.getByText('2 条对话')).toBeTruthy()

    // Click again to close
    act(() => {
      fireEvent.click(historyBtn)
    })
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()
  })

  it('creates new conversation session when clicking + button', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      currentAssistantSessionId: 'existing-id',
      assistantMessages: [
        { id: 'm1', role: 'user', content: '测试消息', createdAt: Date.now(), mode: 'agent' },
      ],
      assistantInput: '正在输入...',
    })

    renderWithProviders(<FloatingAIAssistant />)
    const newBtn = screen.getByTestId('ai-new-session-btn')

    act(() => {
      fireEvent.click(newBtn)
    })

    const state = useAIStore.getState()
    expect(state.currentAssistantSessionId).toBeNull()
    expect(state.assistantMessages).toEqual([])
    expect(state.assistantInput).toBe('')
    // Previous messages should have been auto-synced to sessions
    expect(state.assistantSessions.length).toBeGreaterThan(0)
    expect(state.assistantSessions[0].title).toBe('测试消息')
  })

  it('switches and loads session when clicking session item in history panel', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantSessions: [
        {
          id: 'session-1',
          title: '会话 1',
          messages: [
            { id: '1', role: 'user', content: '问题 1', createdAt: Date.now(), mode: 'agent' },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mode: 'agent',
        },
        {
          id: 'session-2',
          title: '会话 2',
          messages: [
            { id: '2', role: 'user', content: '问题 2', createdAt: Date.now(), mode: 'chat' },
          ],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mode: 'chat',
        },
      ],
      currentAssistantSessionId: 'session-1',
      assistantMessages: [
        { id: '1', role: 'user', content: '问题 1', createdAt: Date.now(), mode: 'agent' },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Open history
    act(() => {
      fireEvent.click(screen.getByTestId('ai-history-toggle-btn'))
    })

    // Click session-2
    act(() => {
      fireEvent.click(screen.getByTestId('session-item-session-2'))
    })

    const state = useAIStore.getState()
    expect(state.currentAssistantSessionId).toBe('session-2')
    expect(state.assistantMessages[0].content).toBe('问题 2')
    expect(state.assistantMode).toBe('chat')
    // History panel should be closed after selection
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()
  })

  it('deletes single session item from history panel', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantSessions: [
        {
          id: 'session-del',
          title: '将要被删除的会话',
          messages: [{ id: '1', role: 'user', content: '测试', createdAt: Date.now(), mode: 'agent' }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Open history
    act(() => {
      fireEvent.click(screen.getByTestId('ai-history-toggle-btn'))
    })

    const delBtn = screen.getByTestId('delete-session-session-del')
    act(() => {
      fireEvent.click(delBtn)
    })

    expect(useAIStore.getState().assistantSessions.length).toBe(0)
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()
    expect(screen.getByText('您好，欢迎使用')).toBeTruthy()
  })

  it('automatically closes history panel and jumps to home page when clearing all history', () => {
    window.confirm = vi.fn().mockReturnValue(true)
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantSessions: [
        {
          id: 'session-1',
          title: '会话 1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mode: 'agent',
          messages: [],
        },
        {
          id: 'session-2',
          title: '会话 2',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          mode: 'agent',
          messages: [],
        },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    act(() => {
      fireEvent.click(screen.getByTestId('ai-history-toggle-btn'))
    })
    expect(screen.getByTestId('ai-history-panel')).toBeTruthy()

    const clearAllBtn = screen.getByTestId('ai-clear-all-sessions-btn')
    act(() => {
      fireEvent.click(clearAllBtn)
    })

    expect(useAIStore.getState().assistantSessions.length).toBe(0)
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()
    expect(screen.getByText('您好，欢迎使用')).toBeTruthy()
  })

  it('closes history panel when Escape key is pressed', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantSessions: [],
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Open history
    act(() => {
      fireEvent.click(screen.getByTestId('ai-history-toggle-btn'))
    })
    expect(screen.getByTestId('ai-history-panel')).toBeTruthy()

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    // History panel should be closed, but assistant dialog remains open
    expect(screen.queryByTestId('ai-history-panel')).toBeNull()
    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(true)

    // Press Escape again should close the dialog
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(useAIStore.getState().isFloatingAssistantOpen).toBe(false)
  })

  it('displays stop buttons and stops response when clicking stop button', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      isAssistantResponding: true,
      assistantMascotMood: 'thinking',
      assistantMessages: [
        { id: '1', role: 'user', content: '测试排查', createdAt: Date.now(), mode: 'agent' },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Verify stop buttons are rendered
    const stopBtn = screen.getByTestId('ai-stop-responding-btn')
    const stopThinkingBtn = screen.getByTestId('ai-stop-thinking-btn')
    expect(stopBtn).toBeTruthy()
    expect(stopThinkingBtn).toBeTruthy()

    // Click stop button
    act(() => {
      fireEvent.click(stopBtn)
    })

    const state = useAIStore.getState()
    expect(state.isAssistantResponding).toBe(false)
    expect(state.assistantMascotMood).toBe('idle')
  })

  it('stops generating response when Escape key is pressed while responding', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      isAssistantResponding: true,
      assistantMascotMood: 'thinking',
    })

    renderWithProviders(<FloatingAIAssistant />)

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    const state = useAIStore.getState()
    expect(state.isAssistantResponding).toBe(false)
    expect(state.assistantMascotMood).toBe('idle')
    // Assistant dialog should still remain open
    expect(state.isFloatingAssistantOpen).toBe(true)
  })

  it('streams response chunks and displays streaming cursor, stopping gracefully on stop', async () => {
    vi.useFakeTimers()
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [],
    })

    const { sendAssistantMessage, stopAssistantResponding } = useAIStore.getState()

    // Start sending
    const promise = sendAssistantMessage('测试流式输出')

    // Advance time slightly to let initial delay pass and first chunks stream
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })

    // Expect message is streaming in state
    let state = useAIStore.getState()
    expect(state.assistantMessages.length).toBe(2)
    const assistantMsg = state.assistantMessages[1]
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.status).toBe('streaming')
    expect(assistantMsg.content.length).toBeGreaterThan(0)

    // Stop responding mid-stream
    act(() => {
      stopAssistantResponding()
    })

    state = useAIStore.getState()
    expect(state.isAssistantResponding).toBe(false)
    // Partial content is preserved and status is marked done
    expect(state.assistantMessages[1].status).toBe('done')
    expect(state.assistantMessages[1].content.length).toBeGreaterThan(0)

    await promise
    vi.useRealTimers()
  })

  it('supports one-click copying for both user questions and AI responses with feedback', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        { id: 'msg-u1', role: 'user', content: '查看当前系统磁盘使用率', createdAt: Date.now() },
        { id: 'msg-a1', role: 'assistant', content: '可以使用 `df -h` 查看各个分区挂载及空间占用。', createdAt: Date.now() },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    // 1. 复制用户提问
    const copyUserBtn = screen.getByTestId('copy-user-msg-msg-u1')
    expect(copyUserBtn).toBeTruthy()
    act(() => {
      fireEvent.click(copyUserBtn)
    })
    expect(writeTextMock).toHaveBeenCalledWith('查看当前系统磁盘使用率')

    // 2. 复制 AI 全文回答
    const copyAiBtn = screen.getByTestId('copy-ai-msg-msg-a1')
    expect(copyAiBtn).toBeTruthy()
    act(() => {
      fireEvent.click(copyAiBtn)
    })
    expect(writeTextMock).toHaveBeenCalledWith('可以使用 `df -h` 查看各个分区挂载及空间占用。')
    expect(screen.getByText('已复制')).toBeTruthy()
  })

  it('renders compact Antigravity-styled input card with delicate Alibaba-styled stop button', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      isAssistantResponding: true,
      assistantInput: '',
    })

    renderWithProviders(<FloatingAIAssistant />)

    // 验证停止生成按钮（微型精致尺寸 h-5 w-5，带有边框）
    const stopBtn = screen.getByTestId('ai-stop-responding-btn')
    expect(stopBtn).toBeTruthy()
    expect(stopBtn.className).toContain('h-5')
    expect(stopBtn.className).toContain('w-5')

    // 停止后切换回常规发送按钮
    act(() => {
      fireEvent.click(stopBtn)
    })

    expect(useAIStore.getState().isAssistantResponding).toBe(false)
  })

  it('renders Option C command execution card in pending status and handles user approval and rejection', async () => {
    const msgId = 'msg_test_card_1'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '建议检查磁盘空间占用情况：',
          createdAt: Date.now(),
          status: 'done',
          executionCard: {
            id: 'exec_card_1',
            command: 'df -h',
            explanation: '查看所有文件系统挂载点磁盘占用',
            decision: {
              allowed: true,
              isReadOnly: true,
              riskLevel: 'safe',
              reason: '经过只读安全白名单校验',
              safeToAutoExecute: false,
            },
            status: 'pending',
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 验证执行卡片渲染
    const cardEl = screen.getByTestId(`execution-card-${msgId}`)
    expect(cardEl).toBeTruthy()
    expect(screen.getByText('等待执行授权')).toBeTruthy()
    expect(screen.getByText('已通过只读白名单校验')).toBeTruthy()
    expect(screen.getByText('df -h')).toBeTruthy()

    // 验证操作按钮存在
    const executeBtn = screen.getByTestId(`execute-cmd-${msgId}`)
    const rejectBtn = screen.getByTestId(`reject-cmd-${msgId}`)
    expect(executeBtn).toBeTruthy()
    expect(rejectBtn).toBeTruthy()

    // 点击执行
    await act(async () => {
      fireEvent.click(executeBtn)
    })

    await vi.waitFor(() => {
      const updatedCard = useAIStore.getState().assistantMessages[0].executionCard
      expect(updatedCard?.status).toBe('executed')
      expect(updatedCard?.output).toBeTruthy()
    })

    unmount()
  })

  it('handles user rejecting Option C command execution card', async () => {
    const msgId = 'msg_test_card_reject'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '建议检查内存占用：',
          createdAt: Date.now(),
          status: 'done',
          executionCard: {
            id: 'exec_card_2',
            command: 'free -m',
            explanation: '查看内存使用',
            decision: {
              allowed: true,
              isReadOnly: true,
              riskLevel: 'safe',
              reason: '经过只读安全白名单校验',
              safeToAutoExecute: false,
            },
            status: 'pending',
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const rejectBtn = screen.getByTestId(`reject-cmd-${msgId}`)
    await act(async () => {
      fireEvent.click(rejectBtn)
    })

    const updatedCard = useAIStore.getState().assistantMessages[0].executionCard
    expect(updatedCard?.status).toBe('rejected')

    unmount()
  })

  it('renders Option C command execution card in blocked status for dangerous operations', () => {
    const msgId = 'msg_test_blocked_1'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '尝试执行高危删除：',
          createdAt: Date.now(),
          status: 'done',
          executionCard: {
            id: 'exec_card_blocked',
            command: 'rm -rf /var/log/*',
            explanation: '强制删除日志',
            decision: {
              allowed: false,
              isReadOnly: false,
              riskLevel: 'blocked',
              reason: '高危文件删除指令，已被只读安全决策网关硬阻断',
              safeToAutoExecute: false,
              blockedReason: '严厉禁止执行 rm 强制递归删除',
            },
            status: 'blocked',
            error: '严厉禁止执行 rm 强制递归删除',
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    expect(screen.getByText('安全拦截阻断')).toBeTruthy()
    expect(screen.getByText('严厉禁止执行 rm 强制递归删除')).toBeTruthy()
    // 不应该展示执行按钮
    expect(screen.queryByTestId(`execute-cmd-${msgId}`)).toBeNull()

    unmount()
  })

  it('correctly parses thinking process and main content with parseThinkingAndContent', () => {
    const raw = `<think>
正在分析目标服务器内存指标...
发现 EMQX 消息服务占用最高。
</think>

### 🎯 排查结论总结
当前内存占用最高的是 **EMQX**。`

    const res = parseThinkingAndContent(raw)
    expect(res.thinking).toContain('正在分析目标服务器内存指标')
    expect(res.mainContent).toContain('### 🎯 排查结论总结')
    expect(res.isStreamingThinking).toBe(false)

    // 测试未闭合流式态
    const streamingRaw = `<think>正在深度推导中`
    const streamRes = parseThinkingAndContent(streamingRaw)
    expect(streamRes.thinking).toBe('正在深度推导中')
    expect(streamRes.isStreamingThinking).toBe(true)

    // 测试无 think 标签普通消息
    const normal = '普通文本回答'
    const normalRes = parseThinkingAndContent(normal)
    expect(normalRes.thinking).toBeNull()
    expect(normalRes.mainContent).toBe('普通文本回答')
  })

  it('renders thinking accordion collapsed by default and allows user to toggle expansion', () => {
    const msgId = 'msg_think_test'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: `<think>这是深度思考推演细节</think>\n\n经排查，一切正常。`,
          createdAt: Date.now(),
          mode: 'agent',
          status: 'done',
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 默认折叠，不直接展示思考正文，只展示收折栏
    expect(screen.getByTestId('ai-thinking-accordion')).toBeTruthy()
    expect(screen.getByText('展开思考')).toBeTruthy()
    expect(screen.queryByTestId('ai-thinking-content')).toBeNull()

    // 点击“展开思考”
    fireEvent.click(screen.getByText('展开思考'))
    expect(screen.getByTestId('ai-thinking-content')).toBeTruthy()
    expect(screen.getByText('这是深度思考推演细节')).toBeTruthy()
    expect(screen.getByText('收起思考')).toBeTruthy()

    // 再次点击收起
    fireEvent.click(screen.getByText('收起思考'))
    expect(screen.queryByTestId('ai-thinking-content')).toBeNull()

    unmount()
  })

  it('implements terminal-like scroll pinning in ThinkingAccordion (auto-tracks unless scrolled up)', async () => {
    const msgId = 'msg_thinking_scroll'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '<think>第一行思考\n第二行思考\n第三行思考</think>\n\n分析结果',
          createdAt: Date.now(),
          mode: 'agent',
          status: 'responding',
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 展开思考
    fireEvent.click(screen.getByText('展开思考'))
    const thinkingContent = screen.getByTestId('ai-thinking-content')
    expect(thinkingContent).toBeTruthy()

    // 模拟 DOM 滚动尺寸
    Object.defineProperty(thinkingContent, 'scrollHeight', { value: 500, configurable: true, writable: true })
    Object.defineProperty(thinkingContent, 'clientHeight', { value: 200, configurable: true, writable: true })
    thinkingContent.scrollTop = 300 // 500 - 300 - 200 = 0 (处于最底部)

    // 用户向上滑动：scrollTop 变为 100 -> 距离底部 500 - 100 - 200 = 200 > 30px
    thinkingContent.scrollTop = 100
    fireEvent.scroll(thinkingContent)

    // 此时用户已向上滑动，触发思考内容更新
    useAIStore.setState({
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '<think>第一行思考\n第二行思考\n第三行思考\n第四行新输出</think>\n\n分析结果',
          createdAt: Date.now(),
          mode: 'agent',
          status: 'responding',
        },
      ],
    })

    // scrollTop 不应该被强行拉到 500，应保持在用户的浏览位置
    expect(thinkingContent.scrollTop).toBe(100)

    // 用户滑回底部：scrollTop 变为 280 -> 距离底部 500 - 280 - 200 = 20 <= 30px
    thinkingContent.scrollTop = 280
    fireEvent.scroll(thinkingContent)

    // 再次触发思考更新，应该恢复自动追踪到底部
    Object.defineProperty(thinkingContent, 'scrollHeight', { value: 600, configurable: true, writable: true })
    useAIStore.setState({
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '<think>第一行思考\n第二行思考\n第三行思考\n第四行新输出\n第五行持续思考</think>\n\n分析结果',
          createdAt: Date.now(),
          mode: 'agent',
          status: 'responding',
        },
      ],
    })

    await waitFor(() => {
      expect(thinkingContent.scrollTop).toBe(600)
    })

    unmount()
  })

  it('implements terminal-like scroll tracking and scroll-to-bottom button in main chat container', async () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg_1',
          role: 'user',
          content: '排查服务器内存',
          createdAt: Date.now(),
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: '正在排查...',
          createdAt: Date.now(),
          mode: 'chat',
          status: 'responding',
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const chatContainer = document.querySelector('.overflow-y-auto.p-4') as HTMLDivElement
    expect(chatContainer).toBeTruthy()

    Object.defineProperty(chatContainer, 'scrollHeight', { value: 1000, configurable: true, writable: true })
    Object.defineProperty(chatContainer, 'clientHeight', { value: 400, configurable: true, writable: true })
    chatContainer.scrollTop = 600 // 处于底部

    // 向上滚动
    fireEvent.scroll(chatContainer, { target: { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 } })

    // 向上滑动后，浮动“追踪最新输出”按钮应该出现
    expect(screen.getByTestId('ai-scroll-to-bottom-btn')).toBeTruthy()

    // 点击该按钮应恢复追踪并滚动到底部
    fireEvent.click(screen.getByTestId('ai-scroll-to-bottom-btn'))
    expect(chatContainer.scrollTop).toBe(1000)
    expect(screen.queryByTestId('ai-scroll-to-bottom-btn')).toBeNull()

    unmount()
  })

  it('renders execution summary banner on execution card when card.summary is present', () => {
    const msgId = 'msg_summary_test'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: '以下是采样结果：',
          createdAt: Date.now(),
          mode: 'agent',
          status: 'done',
          executionCard: {
            id: 'exec_card_summary',
            command: 'ps aux --sort=-%mem | head -n 10',
            decision: {
              allowed: true,
              isReadOnly: true,
              riskLevel: 'safe',
              reason: '安全只读指令',
              safeToAutoExecute: true,
            },
            status: 'executed',
            output: 'root 8192 1.2 8.4 ...',
            summary: '经终端采样分析，当前资源占用最高的是进程【EMQX 消息服务】(PID: 8192，内存占比: 8.4%)。',
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 默认收起为紧凑药丸栏，保障对话体验干净利落
    expect(screen.getByText('展开详情')).toBeTruthy()
    fireEvent.click(screen.getByText('展开详情'))

    expect(screen.getByTestId('ai-card-summary')).toBeTruthy()
    expect(screen.getByText(/经终端采样分析，当前资源占用最高的是进程/)).toBeTruthy()

    const deepBtn = screen.getByTestId(`deep-analyze-cmd-${msgId}`)
    expect(deepBtn).toBeTruthy()
    expect(screen.getByText('让 AI 深度诊断此输出')).toBeTruthy()

    unmount()
  })

  it('renders interactive terminal card for watch/htop commands and dispatches insert-terminal-command', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-interactive',
          role: 'assistant',
          content: '建议使用 watch 监控：',
          createdAt: Date.now(),
          mode: 'agent',
          status: 'done',
          executionCard: {
            id: 'exec_card_interactive',
            command: "watch -n 1 'ps aux | head -n 5'",
            decision: {
              allowed: false,
              isReadOnly: false,
              riskLevel: 'notice',
              isInteractive: true,
              reason: '命令「watch」为常驻交互式终端程序',
              safeToAutoExecute: false,
              blockedReason: '该指令属于常驻监控程序，适合在左侧主终端窗口中持续观察',
            },
            status: 'blocked',
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // Should NOT show blocked title
    expect(screen.queryByText('安全拦截阻断')).toBeNull()

    // Should show interactive title and badge
    expect(screen.getByText('交互式终端指令')).toBeTruthy()
    expect(screen.getByText('需在终端交互运行')).toBeTruthy()

    // Click "填入终端" (execute: false)
    const insertBtn = screen.getByTestId('insert-cmd-msg-interactive')
    expect(insertBtn).toBeTruthy()
    act(() => {
      fireEvent.click(insertBtn)
    })
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'insert-terminal-command',
        detail: {
          command: "watch -n 1 'ps aux | head -n 5'",
          execute: false,
        },
      }),
    )

    // Click "在终端运行" (execute: true)
    const runBtn = screen.getByTestId('run-terminal-cmd-msg-interactive')
    expect(runBtn).toBeTruthy()
    act(() => {
      fireEvent.click(runBtn)
    })
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'insert-terminal-command',
        detail: {
          command: "watch -n 1 'ps aux | head -n 5'",
          execute: true,
        },
      }),
    )

    dispatchSpy.mockRestore()
    unmount()
  })

  it('triggers cluster inspection when clicking "巡检所有服务器" card', () => {
    useAIStore.setState({ isFloatingAssistantOpen: true })
    const sendSpy = vi.fn()
    useAIStore.setState({ sendAssistantMessage: sendSpy })
    renderWithProviders(<FloatingAIAssistant />)

    const clusterCard = screen.getByText('巡检所有服务器')
    fireEvent.click(clusterCard)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('帮我全面巡检已纳管的所有服务器'),
    )
  })

  it('renders UnattachedServerPicker when unattached interception message is present', () => {
    useAppStore.setState({
      servers: [
        { id: 'srv-1', name: 'Web Server', host: '192.168.1.100', port: 22, username: 'root' },
        { id: 'srv-2', name: 'DB Server', host: '192.168.1.200', port: 22, username: 'root' },
      ],
    } as any)

    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-unattached',
          role: 'assistant',
          content: '💡 **当前未连接任何活动服务器终端**\n\n系统检测到您当前未打开任何 SSH 终端标签页...',
          createdAt: Date.now(),
        },
      ],
    })

    const sendSpy = vi.fn()
    useAIStore.setState({ sendAssistantMessage: sendSpy })

    renderWithProviders(<FloatingAIAssistant />)

    expect(screen.getByTestId('unattached-server-picker')).toBeTruthy()
    expect(screen.getByText('Web Server')).toBeTruthy()
    expect(screen.getByText('DB Server')).toBeTruthy()

    // 1. Single click
    const probeBtn1 = screen.getByTestId('btn-probe-server-srv-1')
    fireEvent.click(probeBtn1)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('请帮我全面体检【Web Server】服务器 (192.168.1.100)'),
    )

    // 2. Inspect all
    const inspectAllBtn = screen.getByTestId('btn-inspect-all-servers')
    fireEvent.click(inspectAllBtn)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('帮我全面巡检已纳管的所有服务器'),
    )

    // 3. Multi-select batch
    const cb1 = screen.getByTestId('checkbox-server-srv-1')
    const cb2 = screen.getByTestId('checkbox-server-srv-2')
    fireEvent.click(cb1)
    fireEvent.click(cb2)

    const batchBtn = screen.getByTestId('btn-batch-probe-servers')
    expect(batchBtn).toBeTruthy()
    fireEvent.click(batchBtn)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('请帮我巡检以下服务器：'),
    )
  })

  it('renders UnattachedServerPicker along with pipelineExplain when message suggests target server execution at the bottom', () => {
    useAppStore.setState({
      servers: [
        { id: 'srv-1', name: 'Web Server', host: '192.168.1.100', port: 22, username: 'root' },
      ],
    } as any)

    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-explain',
          role: 'assistant',
          content: 'awk 列提取 -> sort 排序 -> uniq 统计。\n\n💡 若需在真实服务器日志中采样验证上述命令，可在下方卡片中选择目标主机一键下发。',
          createdAt: Date.now(),
          pipelineExplain: {
            fullCommand: "awk '{print $1}' access.log | sort | uniq -c",
            summary: '日志 IP 提取',
            isPipeline: true,
            hasDestructiveRisk: false,
            steps: [
              {
                stepIndex: 1,
                rawCommand: "awk '{print $1}' access.log",
                program: 'awk',
                args: ["'{print $1}'", 'access.log'],
                actionDescription: '提取第 1 列字段',
                flagsExplanation: [],
                riskLevel: 'safe',
              },
            ],
          },
        },
      ],
    })

    renderWithProviders(<FloatingAIAssistant />)

    expect(screen.getByTestId('pipeline-blocks-viewer')).toBeTruthy()
    expect(screen.getByTestId('unattached-server-picker')).toBeTruthy()
    expect(screen.getByText('（点选主机一键发起实机排查）')).toBeTruthy()
  })

  it('forwards original user query when clicking server in UnattachedServerPicker', () => {
    useAppStore.setState({
      servers: [
        { id: 'srv-prod', name: '中间件生产', host: '106.14.205.23', port: 22, username: 'root' },
      ],
    } as any)

    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-u1',
          role: 'user',
          content: '请帮我排查当前服务器内存和 CPU 占用最高的是哪些进程？',
          createdAt: Date.now() - 1000,
        },
        {
          id: 'msg-a1',
          role: 'assistant',
          content: '当前未连接任何活动终端，无法直接执行服务器资源排查。\n\n请明确回复要排查哪台服务器',
          createdAt: Date.now(),
        },
      ],
    })

    const sendSpy = vi.fn()
    useAIStore.setState({ sendAssistantMessage: sendSpy })

    renderWithProviders(<FloatingAIAssistant />)

    expect(screen.getByTestId('unattached-server-picker')).toBeTruthy()
    expect(screen.getByText('中间件生产')).toBeTruthy()

    const probeBtn = screen.getByTestId('btn-probe-server-srv-prod')
    fireEvent.click(probeBtn)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('针对【中间件生产】(106.14.205.23) 服务器：请帮我排查当前服务器内存和 CPU 占用最高的是哪些进程？'),
    )
  })

  it('applies default color scheme when not in terminal module', () => {
    useAppStore.setState({
      activeTabId: 'tab-overview',
      tabs: [{ id: 'tab-overview', title: 'Overview', module: 'overview', serverId: 'srv-1' } as any],
    })
    useAIStore.setState({ isFloatingAssistantOpen: true })

    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    expect(dialog.className).toContain('bg-background/95')
  })

  it('follows terminal context menu color scheme when inside terminal module', () => {
    useAppStore.setState({
      activeTabId: 'tab-term-1',
      tabs: [{ id: 'tab-term-1', title: 'Terminal', module: 'terminal', serverId: 'srv-1' } as any],
      terminalThemeId: 'default-dark',
    })
    useAIStore.setState({ isFloatingAssistantOpen: true })

    renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    expect(dialog.className).toContain('bg-[#22263a]/96')
    expect(dialog.className).toContain('border-white/[0.14]')
  })

  it('renders agent decisions accordion collapsed by default and allows user to toggle expansion', () => {
    const msgId = 'msg_decisions_test'
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: msgId,
          role: 'assistant',
          content: `> 🤖 **Agent 智能决策调用 (第 1 步)：安全探测【disk】指标...**\n\n> 🤖 **Agent 智能决策调用 (第 2 步)：只读排障指令【df -hT】...**\n\n磁盘使用率安全。`,
          createdAt: Date.now(),
          mode: 'agent',
          status: 'done',
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 默认折叠，只显示“Agent 智能决策调用”与“展开调用”
    expect(screen.getByTestId('ai-decisions-accordion')).toBeTruthy()
    expect(screen.getByText('展开调用')).toBeTruthy()
    expect(screen.getByText(/共 2 步调用/)).toBeTruthy()
    expect(screen.queryByTestId('ai-decisions-content')).toBeNull()

    // 磁盘使用率安全正文正常显示，不会被吞噬
    expect(screen.getByText('磁盘使用率安全。')).toBeTruthy()

    // 点击“展开调用”
    fireEvent.click(screen.getByText('展开调用'))
    expect(screen.getByTestId('ai-decisions-content')).toBeTruthy()
    expect(screen.getByText('安全探测【disk】指标')).toBeTruthy()
    expect(screen.getByText('只读排障指令【df -hT】')).toBeTruthy()
    expect(screen.getByText('收起调用')).toBeTruthy()

    // 再次点击收起
    fireEvent.click(screen.getByText('收起调用'))
    expect(screen.queryByTestId('ai-decisions-content')).toBeNull()

    unmount()
  })

  it('decouples message badges between Agent 运维执行 and AIOps 智能解答 based on actions', () => {
    useAIStore.setState({
      isFloatingAssistantOpen: true,
      assistantMessages: [
        // 1. Agent 模式但无执行动作（如日常问答或非运维百科）：应显示 AIOps 智能解答
        {
          id: 'msg_qa_1',
          role: 'assistant',
          content: '作为 Qshell 运维小助手，我专注于帮助您排查 Linux 服务器故障与编写 Shell 脚本。',
          createdAt: Date.now() - 3000,
          mode: 'agent',
          status: 'done',
        },
        // 2. Agent 模式且有执行卡片：应显示 Agent 运维执行
        {
          id: 'msg_exec_2',
          role: 'assistant',
          content: '经排查，系统当前内存占用正常。',
          createdAt: Date.now() - 2000,
          mode: 'agent',
          status: 'done',
          executionCard: {
            id: 'card_1',
            command: 'free -m',
            decision: { allowed: true, riskLevel: 'safe', reason: '只读命令', isReadOnly: true, safeToAutoExecute: true },
            status: 'executed',
          },
        },
        // 3. Chat 咨询解答模式：应显示 Chat 咨询解答
        {
          id: 'msg_chat_3',
          role: 'assistant',
          content: 'SSH 配置文件路径通常为 /etc/ssh/sshd_config。',
          createdAt: Date.now() - 1000,
          mode: 'chat',
          status: 'done',
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    // 验证所有徽标元素
    const badges = screen.getAllByTestId('ai-bubble-badge')
    expect(badges.length).toBe(3)

    // 气泡 1：纯解答问答 -> AIOps 智能解答
    expect(badges[0].textContent).toContain('AIOps 智能解答')
    expect(badges[0].textContent).not.toContain('Agent 运维执行')

    // 气泡 2：有命令执行卡片 -> Agent 运维执行
    expect(badges[1].textContent).toContain('Agent 运维执行')

    // 气泡 3：Chat 模式 -> Chat 咨询解答
    expect(badges[2].textContent).toContain('Chat 咨询解答')

    unmount()
  })

  it('renders detected-explain-pill when user inputs a piped shell command', () => {
    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      assistantInput: "cat access.log | awk '{print $1}' | sort | uniq -c",
      assistantMessages: [],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const pill = screen.getByTestId('detected-explain-pill')
    expect(pill).toBeTruthy()
    expect(pill.textContent).toContain('检测到复合指令/管道')

    unmount()
  })

  it('renders PipelineBlocksViewer when message has pipelineExplain', () => {
    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg_pipe_1',
          role: 'assistant',
          content: '已完成管道拆解',
          createdAt: Date.now(),
          status: 'done',
          pipelineExplain: {
            fullCommand: "cat access.log | awk '{print $1}'",
            summary: '提取第一列客户端IP',
            isPipeline: true,
            hasDestructiveRisk: false,
            steps: [
              {
                stepIndex: 1,
                rawCommand: 'cat access.log',
                program: 'cat',
                args: ['access.log'],
                actionDescription: '读取日志文件',
                riskLevel: 'safe',
              },
              {
                stepIndex: 2,
                rawCommand: "awk '{print $1}'",
                program: 'awk',
                args: ["'{print $1}'"],
                actionDescription: '提取第一列',
                riskLevel: 'safe',
              },
            ],
          },
        },
      ],
    })

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    expect(screen.getByTestId('pipeline-blocks-viewer')).toBeTruthy()
    expect(screen.getByText('STEP 01')).toBeTruthy()
    expect(screen.getByText('STEP 02')).toBeTruthy()
    expect(screen.getByText('读取日志文件')).toBeTruthy()

    unmount()
  })

  it('opens context menu on right click with selected text and dispatches insert-terminal-command', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'tab-1',
          title: 'Terminal 1',
          module: 'terminal',
          serverId: 'srv-1',
          serverName: 'Test Server',
        },
      ],
      activeTabId: 'tab-1',
    })

    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-tutorial-1',
          role: 'assistant',
          content: '请安装 curl: `sudo apt install -y curl`',
          createdAt: Date.now(),
          status: 'done',
        },
      ],
    })

    const dispatchedEvents: any[] = []
    const handleInsert = (e: Event) => {
      dispatchedEvents.push((e as CustomEvent).detail)
    }
    window.addEventListener('insert-terminal-command', handleInsert)

    const originalGetSelection = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => 'sudo apt install -y curl',
      }) as any

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    fireEvent.contextMenu(dialog, { clientX: 200, clientY: 300 })

    const menu = screen.getByTestId('ai-assistant-context-menu')
    expect(menu).toBeTruthy()

    const runBtn = screen.getByTestId('ai-ctx-run-btn')
    expect(runBtn).toBeTruthy()
    fireEvent.click(runBtn)

    expect(dispatchedEvents).toEqual([
      { command: 'sudo apt install -y curl', execute: true },
    ])

    window.getSelection = originalGetSelection
    window.removeEventListener('insert-terminal-command', handleInsert)
    unmount()
  })

  it('right clicks on code block without text selection and opens context menu with code content', () => {
    useAppStore.setState({
      tabs: [
        {
          id: 'tab-1',
          title: 'Terminal 1',
          module: 'terminal',
          serverId: 'srv-1',
          serverName: 'Test Server',
        },
      ],
      activeTabId: 'tab-1',
    })

    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-code-1',
          role: 'assistant',
          content: '```bash\nufw allow 80/tcp\n```',
          createdAt: Date.now(),
          status: 'done',
        },
      ],
    })

    const originalGetSelection = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '',
      }) as any

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const codeEl = document.querySelector('pre code')
    expect(codeEl).toBeTruthy()

    fireEvent.contextMenu(codeEl!, { clientX: 250, clientY: 350 })

    const menu = screen.getByTestId('ai-assistant-context-menu')
    expect(menu).toBeTruthy()
    expect(menu.textContent).toContain('ufw allow 80/tcp')

    window.getSelection = originalGetSelection
    unmount()
  })

  it('automatically opens context menu on mouseUp when text is selected (like terminal)', async () => {
    vi.useFakeTimers()
    useAppStore.setState({
      tabs: [
        {
          id: 'tab-1',
          title: 'Terminal 1',
          module: 'terminal',
          serverId: 'srv-1',
          serverName: 'Test Server',
        },
      ],
      activeTabId: 'tab-1',
      terminalSelectionToolbar: true,
      terminalCopyPaste: true,
    })

    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextSpy,
      },
    })

    useAIStore.setState({
      enableAiGlobal: true,
      isFloatingAssistantOpen: true,
      assistantMessages: [
        {
          id: 'msg-1',
          role: 'assistant',
          content: '请使用 curl -SL https://example.com/script.sh 下载',
          createdAt: Date.now(),
          status: 'done',
        },
      ],
    })

    const originalGetSelection = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => 'curl -SL https://example.com/script.sh',
      }) as any

    const { unmount } = renderWithProviders(<FloatingAIAssistant />)

    const dialog = screen.getByTestId('ai-assistant-dialog')
    fireEvent.mouseUp(dialog, { button: 0, clientX: 220, clientY: 280 })

    // Advance 25ms timer for selection stabilization
    act(() => {
      vi.advanceTimersByTime(50)
    })

    const menu = screen.getByTestId('ai-assistant-context-menu')
    expect(menu).toBeTruthy()
    expect(menu.textContent).toContain('curl -SL https://example.c')
    expect(menu.querySelector('[title]')?.getAttribute('title')).toBe('curl -SL https://example.com/script.sh')
    expect(writeTextSpy).toHaveBeenCalledWith('curl -SL https://example.com/script.sh')

    window.getSelection = originalGetSelection
    vi.useRealTimers()
    unmount()
  })
})




