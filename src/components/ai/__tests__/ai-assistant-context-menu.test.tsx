/**
 * src/components/ai/__tests__/ai-assistant-context-menu.test.tsx
 *
 * AI 助手右键上下文菜单单元测试
 */

import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  AIAssistantContextMenu,
  type AIAssistantContextMenuState,
} from '../ai-assistant-context-menu'
import { I18nProvider } from '@/i18n/i18n-provider'

function renderMenu(props: Partial<React.ComponentProps<typeof AIAssistantContextMenu>> = {}) {
  const defaultCtx: AIAssistantContextMenuState = {
    x: 100,
    y: 150,
    text: 'docker compose up -d',
    isCode: true,
    hasSelection: true,
  }

  const defaultProps = {
    ctxMenu: defaultCtx,
    isLightTerminal: false,
    isInTerminal: true,
    onClose: vi.fn(),
    onCopy: vi.fn(),
    onExecuteInTerminal: vi.fn(),
    onInsertToTerminal: vi.fn(),
    ...props,
  }

  return {
    ...render(
      <I18nProvider>
        <AIAssistantContextMenu {...defaultProps} />
      </I18nProvider>,
    ),
    props: defaultProps,
  }
}

describe('AIAssistantContextMenu', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders nothing when ctxMenu is null', () => {
    const { container } = renderMenu({ ctxMenu: null })
    expect(container.firstChild).toBeNull()
  })

  it('renders copy, execute and insert buttons for selected command text', () => {
    renderMenu({
      isInTerminal: true,
      ctxMenu: {
        x: 100,
        y: 150,
        text: 'systemctl restart nginx',
        isCode: true,
      },
    })

    expect(screen.getByTestId('ai-assistant-context-menu')).toBeTruthy()
    expect(screen.getByTestId('ai-ctx-copy-btn')).toBeTruthy()
    expect(screen.getByTestId('ai-ctx-run-btn')).toBeTruthy()
    expect(screen.getByTestId('ai-ctx-insert-btn')).toBeTruthy()
    expect(screen.getByText('systemctl restart nginx')).toBeTruthy()
  })

  it('triggers onCopy and onClose when copy button is clicked', () => {
    const onCopy = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onCopy, onClose })

    const copyBtn = screen.getByTestId('ai-ctx-copy-btn')
    fireEvent.click(copyBtn)

    expect(onCopy).toHaveBeenCalledWith('docker compose up -d')
    expect(onClose).toHaveBeenCalled()
  })

  it('triggers onExecuteInTerminal and onClose when run button is clicked', () => {
    const onExecuteInTerminal = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onExecuteInTerminal, onClose, isInTerminal: true })

    const runBtn = screen.getByTestId('ai-ctx-run-btn')
    fireEvent.click(runBtn)

    expect(onExecuteInTerminal).toHaveBeenCalledWith('docker compose up -d')
    expect(onClose).toHaveBeenCalled()
  })

  it('triggers onInsertToTerminal and onClose when insert button is clicked', () => {
    const onInsertToTerminal = vi.fn()
    const onClose = vi.fn()
    renderMenu({ onInsertToTerminal, onClose, isInTerminal: true })

    const insertBtn = screen.getByTestId('ai-ctx-insert-btn')
    fireEvent.click(insertBtn)

    expect(onInsertToTerminal).toHaveBeenCalledWith('docker compose up -d')
    expect(onClose).toHaveBeenCalled()
  })

  it('disables run and insert buttons when not in terminal', () => {
    const onExecuteInTerminal = vi.fn()
    const onInsertToTerminal = vi.fn()
    renderMenu({
      isInTerminal: false,
      onExecuteInTerminal,
      onInsertToTerminal,
    })

    const runBtn = screen.getByTestId('ai-ctx-run-btn')
    const insertBtn = screen.getByTestId('ai-ctx-insert-btn')

    expect((runBtn as HTMLButtonElement).disabled).toBe(true)
    expect((insertBtn as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(runBtn)
    fireEvent.click(insertBtn)

    expect(onExecuteInTerminal).not.toHaveBeenCalled()
    expect(onInsertToTerminal).not.toHaveBeenCalled()
  })

  it('only shows copy message when isFullMessage is true (avoids accidental chat execution)', () => {
    renderMenu({
      ctxMenu: {
        x: 100,
        y: 150,
        text: '您好，以下是推荐的部署方案：',
        isFullMessage: true,
      },
    })

    expect(screen.getByTestId('ai-ctx-copy-btn')).toBeTruthy()
    expect(screen.queryByTestId('ai-ctx-run-btn')).toBeNull()
    expect(screen.queryByTestId('ai-ctx-insert-btn')).toBeNull()
  })

  it('closes on Escape key press', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('executes in terminal on Enter key press when in terminal and not full message', () => {
    const onExecuteInTerminal = vi.fn()
    const onClose = vi.fn()
    renderMenu({
      isInTerminal: true,
      onExecuteInTerminal,
      onClose,
      ctxMenu: {
        x: 100,
        y: 150,
        text: 'ls -la',
        isCode: true,
      },
    })

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onExecuteInTerminal).toHaveBeenCalledWith('ls -la')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on scroll event in capture phase', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    fireEvent.scroll(window)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on pointerdown outside the menu', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalled()
  })
})

