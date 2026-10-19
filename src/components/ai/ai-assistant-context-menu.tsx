/**
 * src/components/ai/ai-assistant-context-menu.tsx
 *
 * AI 助手浮层右键上下文菜单 (AI Assistant Context Menu)
 * 为划选的教程命令、代码块或消息提供快捷「复制」、「在当前终端执行」、「填入当前终端」兜底操作
 */

import React, { useEffect, useRef } from 'react'
import { Copy, Play, Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

export interface AIAssistantContextMenuState {
  x: number
  y: number
  text: string
  isCode?: boolean
  isFullMessage?: boolean
  hasSelection?: boolean
}

export interface AIAssistantContextMenuProps {
  ctxMenu: AIAssistantContextMenuState | null
  isLightTerminal?: boolean
  isInTerminal?: boolean
  onClose: () => void
  onCopy: (text: string) => void
  onExecuteInTerminal: (text: string) => void
  onInsertToTerminal: (text: string) => void
}

/**
 * 边界检测与吸附计算：
 * 弹框左边缘与选区右侧保留 6px 呼吸间距，向下展开；视口不足时智能翻折至上方或左侧，避免遮挡选区内容
 */
export function clampAssistantMenuPosition(x: number, y: number, width = 220, height = 130) {
  const padding = 10
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800

  // 弹框左边缘与选区右边缘对齐（留 6px 呼吸间隙）
  let left = x + 6
  // 如果超出右视口，自动摆放在选区左侧
  if (left + width > vw - padding) {
    left = Math.max(padding, x - width - 6)
  }
  left = Math.max(padding, Math.min(left, vw - width - padding))

  // 弹框左上角从选区当前行位置顺着向下展开
  let top = y + 4
  // 底部溢出处理：如果底部放不下，则向上翻折
  if (top + height > vh - padding) {
    top = Math.max(padding, y - height - 4)
  }
  // 视口边界严格夹紧（防止超出版界或被完全隐藏）
  top = Math.max(padding, Math.min(top, vh - height - padding))

  return { left, top }
}

export function AIAssistantContextMenu({
  ctxMenu,
  isLightTerminal = false,
  isInTerminal = false,
  onClose,
  onCopy,
  onExecuteInTerminal,
  onInsertToTerminal,
}: AIAssistantContextMenuProps) {
  const { t } = useTranslation()
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctxMenu) return

    const handlePointerDown = (e: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && !ctxMenu.isFullMessage && isInTerminal) {
        e.preventDefault()
        e.stopPropagation()
        onExecuteInTerminal(ctxMenu.text)
        onClose()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        e.stopPropagation()
        onCopy(ctxMenu.text)
        onClose()
      }
    }

    const handleScroll = () => {
      onClose()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [ctxMenu, isInTerminal, onClose, onCopy, onExecuteInTerminal])

  if (!ctxMenu) return null

  // 边界吸附检测：预估宽度 220，高度 130
  const pos = clampAssistantMenuPosition(ctxMenu.x, ctxMenu.y, 220, 130)

  // 紧凑截断预览
  const rawText = ctxMenu.text.replace(/\s+/g, ' ').trim()
  const previewText = rawText.length > 26 ? `${rawText.slice(0, 26)}...` : rawText

  const copyLabel = ctxMenu.isFullMessage
    ? t('ai_ctx_copy_message') || '复制消息内容'
    : ctxMenu.isCode
      ? t('ai_ctx_copy_code') || '复制代码'
      : t('ai_ctx_copy') || '复制'

  return (
    <div
      ref={menuRef}
      data-testid="ai-assistant-context-menu"
      className={cn(
        'fixed z-[70] min-w-[200px] max-w-[260px] rounded-xl select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1 ai-assistant-context-menu',
        isLightTerminal
          ? 'bg-white/95 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl'
          : 'bg-[#181a27]/96 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl',
      )}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 头部摘要微标 */}
      <div
        className={cn(
          'px-2.5 py-1 mb-1 text-[10.5px] font-mono truncate select-none border-b',
          isLightTerminal ? 'text-slate-500 border-slate-200/80' : 'text-slate-400 border-white/10',
        )}
        title={ctxMenu.text}
      >
        <span className="opacity-60 mr-1">
          {ctxMenu.isCode ? '[CODE]' : ctxMenu.isFullMessage ? '[MSG]' : '[SEL]'}
        </span>
        <span>{previewText}</span>
      </div>

      {/* 1. 复制 */}
      <button
        type="button"
        data-testid="ai-ctx-copy-btn"
        className={cn(
          'group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left',
          isLightTerminal
            ? 'text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900'
            : 'text-slate-300 hover:bg-white/[0.08] hover:text-slate-100',
        )}
        onClick={() => {
          onCopy(ctxMenu.text)
          onClose()
        }}
      >
        <Copy className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{copyLabel}</span>
        <span
          className={cn(
            'ml-auto text-[10px] font-mono tracking-tight',
            isLightTerminal ? 'text-slate-400' : 'text-slate-400/70',
          )}
        >
          Ctrl+C
        </span>
      </button>

      {/* 2. 在当前终端执行 (仅当选中文本或代码块时提供，防止误将整段聊天文本下发终端) */}
      {!ctxMenu.isFullMessage && (
        <button
          type="button"
          data-testid="ai-ctx-run-btn"
          disabled={!isInTerminal}
          title={!isInTerminal ? (t('ai_ctx_not_in_terminal') || '当前未处于终端窗口') : undefined}
          className={cn(
            'group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 transition-colors text-xs font-mono w-full text-left',
            !isInTerminal
              ? 'opacity-40 cursor-not-allowed text-slate-400'
              : isLightTerminal
                ? 'cursor-pointer text-slate-700 hover:bg-emerald-500/10 hover:text-emerald-700'
                : 'cursor-pointer text-slate-300 hover:bg-emerald-500/15 hover:text-emerald-300',
          )}
          onClick={() => {
            if (!isInTerminal) return
            onExecuteInTerminal(ctxMenu.text)
            onClose()
          }}
        >
          <Play className="h-3.5 w-3.5 text-emerald-400 fill-current shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px]">
            {t('ai_ctx_run_in_terminal') || '在当前终端执行'}
          </span>
          <span
            className={cn(
              'ml-auto text-[10px] font-mono tracking-tight',
              isLightTerminal ? 'text-slate-400' : 'text-slate-400/70',
            )}
          >
            Enter
          </span>
        </button>
      )}

      {/* 3. 填入当前终端 */}
      {!ctxMenu.isFullMessage && (
        <button
          type="button"
          data-testid="ai-ctx-insert-btn"
          disabled={!isInTerminal}
          title={!isInTerminal ? (t('ai_ctx_not_in_terminal') || '当前未处于终端窗口') : undefined}
          className={cn(
            'group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 transition-colors text-xs font-mono w-full text-left',
            !isInTerminal
              ? 'opacity-40 cursor-not-allowed text-slate-400'
              : isLightTerminal
                ? 'cursor-pointer text-slate-700 hover:bg-indigo-500/10 hover:text-indigo-700'
                : 'cursor-pointer text-slate-300 hover:bg-indigo-500/15 hover:text-indigo-300',
          )}
          onClick={() => {
            if (!isInTerminal) return
            onInsertToTerminal(ctxMenu.text)
            onClose()
          }}
        >
          <Terminal className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px]">
            {t('ai_ctx_insert_to_terminal') || '填入当前终端'}
          </span>
        </button>
      )}
    </div>
  )
}
