/**
 * src/components/ai/floating-ai-assistant.tsx
 *
 * Qshell 全局悬浮 AI 助手组件 (Floating AI Assistant & Copilot Mascot)
 * 1. 悬浮吉祥物小人：相对窗口右下角弹性锚定（窗口缩放/全屏时绝不漂移），支持全屏自由拖拽与持久化记忆
 * 2. 对话弹出面板：支持通过顶部标题栏任意拖拽移动、宽高自适应平衡（告别瘦高条）、支持宽屏全景模式
 * 3. 富文本与命令互通：内置 Markdown 语法解析与交互式代码块，支持一键填入终端并执行
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useAIStore } from '@/store/ai-store'
import { useAppStore } from '@/store'
import { getServerConnectionFlags } from '@/services/connection-targets'
import { getTerminalTheme } from '@/utils/terminal-themes'
import { AIMascotAvatar } from './ai-mascot-avatar'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import { renderMarkdown } from '@/lib/markdown'
import {
  Sparkles,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  Plus,
  History,
  X,
  Copy,
  Check,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Rocket,
  HardDrive,
  Activity,
  Cpu,
  GripHorizontal,
  AlertCircle,
  Trash2,
  Clock,
  CircleStop,
  Play,
  ChevronDown,
  ChevronRight,
  Loader2,
  Brain,
  Bot,
  CheckCircle2,
  Settings2,
  RotateCcw,
  PowerOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { hasActiveAIProvider } from '@/store/ai-store'
import type { AIAssistantExecutionCard } from '@/types/ai'
import { PipelineBlocksViewer } from './pipeline-blocks-viewer'
import { detectUserIntent } from '@/services/ai/shell-explainer'
import {
  AIAssistantContextMenu,
  type AIAssistantContextMenuState,
} from './ai-assistant-context-menu'

const MASCOT_SIZE = 48
const STORAGE_MASCOT_OFFSET_KEY = 'qshell_ai_mascot_offset_v5'
const CONTENT_TOP_OFFSET = 88 // 上面到主内容区域 (TabBar + 模块工具栏下方，8px呼吸间距)
const STATUSBAR_BOTTOM_OFFSET = 32 // 下面到页脚 (StatusBar上方，8px呼吸间距)

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface MascotOffset {
  right: number
  bottom: number
}

function clampMascotOffset(offset: MascotOffset): MascotOffset {
  if (typeof window === 'undefined') return offset
  const minBottom = STATUSBAR_BOTTOM_OFFSET + 8 // 40px，高出页脚 8px
  const maxBottom = Math.max(minBottom, window.innerHeight - MASCOT_SIZE - (CONTENT_TOP_OFFSET + 8)) // 距离顶部主内容区至少 8px，严防遮挡标题栏与用户信息
  const minRight = 16
  const maxRight = Math.max(minRight, window.innerWidth - MASCOT_SIZE - 16)

  return {
    right: Math.min(Math.max(minRight, offset.right), maxRight),
    bottom: Math.min(Math.max(minBottom, offset.bottom), maxBottom),
  }
}

/** 隐藏态探头纵向位置：跟随拖到右边界时的鼠标 Y，但避开顶栏与状态栏 */
function clampMascotPeekY(y: number): number {
  if (typeof window === 'undefined') return y
  const minY = CONTENT_TOP_OFFSET + 36
  const maxY = Math.max(minY, window.innerHeight - STATUSBAR_BOTTOM_OFFSET - 36)
  return Math.max(minY, Math.min(y, maxY))
}

const MASCOT_MENU_WIDTH = 196
/** 仅用于判断是否需要向上翻转的预留高度（菜单为固定 3 项）；贴合位置不依赖它 */
const MASCOT_MENU_RESERVE_HEIGHT = 132

/** 小人右键菜单定位：始终紧贴鼠标 4px，视口放不下时向左/上翻转（划词菜单那种大间距定位不适用） */
function clampMascotMenuPosition(x: number, y: number, width: number, height: number) {
  if (typeof window === 'undefined') {
    return { left: x, top: y + 4, bottom: undefined as number | undefined }
  }
  const padding = 8
  const gap = 4
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = x + gap
  if (left + width > vw - padding) left = x - width - gap
  const flipUp = y + gap + height > vh - padding
  return {
    left: Math.max(padding, left),
    top: flipUp ? undefined : y + gap,
    // 向上翻转时用 bottom 定位，浏览器按菜单真实高度向上生长，底边始终落在 y - gap 处，
    // 避免用估算高度算 top 造成菜单与鼠标之间出现空隙。
    bottom: flipUp ? Math.max(padding, vh - y + gap) : undefined,
  }
}

function loadSavedMascotOffset(): MascotOffset {
  try {
    const raw = localStorage.getItem(STORAGE_MASCOT_OFFSET_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
        return clampMascotOffset(parsed)
      }
    }
  } catch {
    /* ignore */
  }
  return { right: 28, bottom: 48 }
}

function saveMascotOffset(offset: MascotOffset) {
  try {
    localStorage.setItem(STORAGE_MASCOT_OFFSET_KEY, JSON.stringify(clampMascotOffset(offset)))
  } catch {
    /* ignore */
  }
}

function formatSessionTime(timestamp: number): string {
  if (!timestamp) return ''
  const now = Date.now()
  const diffSec = Math.floor((now - timestamp) / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}小时前`
  const d = new Date(timestamp)
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const date = d.getDate().toString().padStart(2, '0')
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  return `${month}-${date} ${hours}:${minutes}`
}

export interface AgentDecisionItem {
  step?: number
  description: string
  raw: string
}

/**
 * 助手消息思考过程、智能决策调用与 Markdown 正文分离解析
 */
export function parseThinkingAndContent(raw: string): {
  thinking: string | null
  agentDecisions: AgentDecisionItem[]
  mainContent: string
  isStreamingThinking: boolean
} {
  if (!raw) {
    return {
      thinking: null,
      agentDecisions: [],
      mainContent: '',
      isStreamingThinking: false,
    }
  }

  // 1. 提取 <think>...</think> 思考模块
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g
  const thinkBlocks: string[] = []
  let match: RegExpExecArray | null
  while ((match = thinkRegex.exec(raw)) !== null) {
    if (match[1].trim()) {
      thinkBlocks.push(match[1].trim())
    }
  }

  // 检查尾部是否存在未闭合的 <think> 流式输出
  const lastOpen = raw.lastIndexOf('<think>')
  const lastClose = raw.lastIndexOf('</think>')
  const isStreamingThinking = lastOpen !== -1 && (lastClose === -1 || lastOpen > lastClose)

  if (isStreamingThinking) {
    const unclosed = raw.slice(lastOpen + 7).trim()
    if (unclosed) {
      thinkBlocks.push(unclosed)
    }
  }

  const contentWithoutThink = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim()

  // 2. 提取并收起 Agent 智能决策调用步骤 (避免多轮工具调用刷屏占用大量纵向高度)
  const agentDecisions: AgentDecisionItem[] = []
  const decisionRegex = /^[>\s]*(?:🤖|✨)?\s*\*?\*?Agent\s*智能决策调用(?:\s*\(第\s*(\d+)\s*步\))?[：:]\s*(.*?)(?:\.\.\.)?\*?\*?\s*$/gmu
  let dMatch: RegExpExecArray | null
  while ((dMatch = decisionRegex.exec(contentWithoutThink)) !== null) {
    const stepNum = dMatch[1] ? parseInt(dMatch[1], 10) : undefined
    const desc = dMatch[2] ? dMatch[2].replace(/\*+/g, '').trim() : ''
    if (desc) {
      agentDecisions.push({
        step: stepNum,
        description: desc,
        raw: dMatch[0].trim(),
      })
    }
  }

  // 尾部流式未闭合行容错 (例如 "> 🤖 **Agent 智能决策调用 (第 1 步)：正在执行...")
  const trailingIncomplete = /^[>\s]*(?:🤖|✨)?\s*\*?\*?Agent\s*智能决策调用(?:\s*\(第\s*(\d+)\s*步\))?[：:]?\s*([^\n]*)$/mu
  const trailingMatch = trailingIncomplete.exec(contentWithoutThink)
  if (trailingMatch && !agentDecisions.some((d) => d.raw.includes(trailingMatch[0].trim()))) {
    const stepNum = trailingMatch[1] ? parseInt(trailingMatch[1], 10) : undefined
    const desc = trailingMatch[2] ? trailingMatch[2].replace(/\*+/g, '').trim() : ''
    if (desc || stepNum) {
      agentDecisions.push({
        step: stepNum,
        description: desc || '正在进行智能决策与工具调用...',
        raw: trailingMatch[0].trim(),
      })
    }
  }

  // 将所有提取出的 Agent 决策调用行从 mainContent 中完全移除并清洗多余引用符
  const mainContent = contentWithoutThink
    .replace(decisionRegex, '')
    .replace(trailingIncomplete, '')
    .replace(/^[>\s]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return {
    thinking: thinkBlocks.length > 0 ? thinkBlocks.join('\n\n---\n\n') : null,
    agentDecisions,
    mainContent,
    isStreamingThinking,
  }
}

/**
 * 可折叠思考过程组件 (具备生动的高科技脉冲与思维链跳动动画)
 */
function ThinkingAccordion({
  thinking,
  isStreaming,
  themeStyles,
}: {
  thinking: string
  isStreaming?: boolean
  themeStyles?: any
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isUserScrolledUpRef = useRef<boolean>(false)
  const [showThinkingScrollBtn, setShowThinkingScrollBtn] = useState(false)

  // 当处于展开状态且正在输出/内容变动时，若用户没有向上滑动，自动追踪最新行
  useEffect(() => {
    if (!isExpanded) return
    const el = contentRef.current
    if (!el) return

    if (!isUserScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [thinking, isExpanded, isStreaming])

  // 当流式输出开始时，默认重置为自动追踪底部
  useEffect(() => {
    if (isStreaming) {
      isUserScrolledUpRef.current = false
      setShowThinkingScrollBtn(false)
    }
  }, [isStreaming])

  const handleToggleExpand = () => {
    setIsExpanded((prev) => {
      const next = !prev
      if (next) {
        // 展开时重置追踪状态
        isUserScrolledUpRef.current = false
        setShowThinkingScrollBtn(false)
      }
      return next
    })
  }

  const handleThinkingScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const threshold = 30
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
    isUserScrolledUpRef.current = !isNearBottom
    if (isNearBottom) {
      setShowThinkingScrollBtn(false)
    } else if (isStreaming) {
      setShowThinkingScrollBtn(true)
    }
  }

  const scrollToBottom = () => {
    isUserScrolledUpRef.current = false
    setShowThinkingScrollBtn(false)
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }

  if (!thinking) return null

  const isTerminal = Boolean(themeStyles?.isTerminalMode)

  return (
    <div
      data-testid="ai-thinking-accordion"
      className="relative mb-2 overflow-hidden rounded-lg border border-border/40 bg-muted/25 text-xs"
    >
      {isStreaming && (
        <div className="absolute top-0 left-0 right-0 h-px bg-primary/40 animate-pulse" />
      )}
      <button
        type="button"
        onClick={handleToggleExpand}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors select-none cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Brain className={cn('h-3.5 w-3.5 shrink-0 text-primary/80', isStreaming && 'animate-pulse')} />
          <span className="shrink-0">
            {isStreaming
              ? t('ai_thinking_in_progress') || '正在深度思考...'
              : t('ai_thinking_process') || '深度思考过程'}
          </span>
          {isStreaming && (
            <span className="inline-flex items-center gap-0.5 ml-1 py-0.5 shrink-0">
              <span className="w-1 h-1 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-1 rounded-full bg-primary/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-primary/60 animate-bounce" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10.5px] shrink-0 opacity-70">
          <span>
            {isExpanded
              ? t('ai_thinking_collapse') || '收起思考'
              : t('ai_thinking_expand') || '展开思考'}
          </span>
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
      </button>

      {isExpanded && (
        <div className="relative">
          <div
            ref={contentRef}
            onScroll={handleThinkingScroll}
            data-testid="ai-thinking-content"
            className={cn(
              'border-t border-border/30 px-3 py-2.5 text-[11.5px] leading-relaxed whitespace-pre-wrap font-sans select-text max-h-64 overflow-y-auto text-muted-foreground',
              isTerminal ? 'bg-black/20' : 'bg-background/40',
            )}
          >
            {thinking}
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle rounded-xs bg-primary/60 animate-pulse" />
            )}
            {isStreaming && (
              <div className="mt-2.5 pt-2 border-t border-border/30 flex items-center gap-1.5 text-[10.5px] text-primary/80 select-none">
                <Sparkles className="w-3 h-3 animate-spin shrink-0" />
                <span>AI 正在深层次推导研判中，持续生成思维链...</span>
              </div>
            )}
          </div>
          {showThinkingScrollBtn && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-2 right-3 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-background/90 text-foreground border border-border/50 shadow-sm hover:bg-muted cursor-pointer backdrop-blur-xs transition-all animate-in fade-in"
            >
              <ArrowDown className="w-2.5 h-2.5 text-primary animate-bounce" />
              <span>追踪思考最新行</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 可折叠 Agent 智能决策调用组件 (默认收起，具备执行中旋转状态指示)
 */
function AgentDecisionsAccordion({
  decisions,
  isStreaming,
  themeStyles,
}: {
  decisions: AgentDecisionItem[]
  isStreaming?: boolean
  themeStyles?: any
}) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)

  if (!decisions || decisions.length === 0) return null

  const isTerminal = Boolean(themeStyles?.isTerminalMode)

  return (
    <div
      data-testid="ai-decisions-accordion"
      className="relative mb-2 overflow-hidden rounded-lg border border-border/40 bg-muted/25 text-xs"
    >
      {isStreaming && (
        <div className="absolute top-0 left-0 right-0 h-px bg-primary/40 animate-pulse" />
      )}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors select-none cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Bot className={cn('h-3.5 w-3.5 shrink-0 text-primary/80', isStreaming && 'animate-pulse')} />
          <span className="shrink-0">
            {t('ai_agent_decisions_title') || 'Agent 智能决策调用'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[9.5px] text-primary shrink-0">
            {isStreaming && <QshellLoader size="xs" />}
            共 {decisions.length} 步调用{isStreaming ? ' · 远程探针执行中' : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10.5px] shrink-0 opacity-70">
          <span>
            {isExpanded
              ? t('ai_decisions_collapse') || '收起调用'
              : t('ai_decisions_expand') || '展开调用'}
          </span>
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </div>
      </button>

      {isExpanded && (
        <div
          data-testid="ai-decisions-content"
          className={cn(
            'border-t border-border/30 px-3 py-2 space-y-1 text-[11px] max-h-60 overflow-y-auto select-text',
            isTerminal ? 'bg-black/20' : 'bg-background/40',
          )}
        >
          {decisions.map((item, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-foreground/85"
            >
              <span className="shrink-0 rounded border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                第 {item.step ?? idx + 1} 步
              </span>
              <span className="leading-snug break-words">
                {item.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 助手消息 Markdown 与代码块分段渲染组件（集成思考过程与智能决策折叠）
 */
function AssistantMessageRenderer({
  content,
  onCopy,
  copiedCode,
  isStreaming,
  themeStyles,
}: {
  content: string
  onCopy: (code: string) => void
  copiedCode: string | null
  isStreaming?: boolean
  themeStyles?: any
}) {
  const { thinking, agentDecisions, mainContent, isStreamingThinking } = useMemo(
    () => parseThinkingAndContent(content),
    [content],
  )

  const parts = useMemo(() => {
    const result: Array<{ type: 'markdown' | 'code'; text: string; lang?: string }> = []
    const regex = /```([a-zA-Z0-9_-]*)[^\n\r]*(?:\r?\n)([\s\S]*?)```/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(mainContent)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: 'markdown',
          text: mainContent.slice(lastIndex, match.index),
        })
      }
      result.push({
        type: 'code',
        lang: match[1]?.trim() || 'bash',
        text: match[2].trim(),
      })
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < mainContent.length) {
      result.push({
        type: 'markdown',
        text: mainContent.slice(lastIndex),
      })
    }
    return result
  }, [mainContent])

  return (
    <div className="space-y-2 text-xs leading-relaxed">
      {thinking && (
        <ThinkingAccordion
          thinking={thinking}
          isStreaming={isStreaming && (isStreamingThinking || !mainContent)}
          themeStyles={themeStyles}
        />
      )}
      {agentDecisions.length > 0 && (
        <AgentDecisionsAccordion
          decisions={agentDecisions}
          isStreaming={isStreaming && !isStreamingThinking}
          themeStyles={themeStyles}
        />
      )}
      {/* 若处于流式生成中，且尚未输出任何正文（如正在思考或工具执行），呈现轻量级的脉冲加载提示，避免静止假死感 */}
      {isStreaming && !mainContent && (
        <div className="flex items-center gap-2 py-1.5 px-2 text-[11.5px] text-muted-foreground animate-pulse select-none">
          <Sparkles className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
          <span>
            {isStreamingThinking
              ? 'Agent 正在深入分析系统状态与拓扑...'
              : 'Agent 正在远程下发安全只读探针并汇总诊断...'}
          </span>
        </div>
      )}
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          const isCopied = copiedCode === part.text

          return (
            <div
              key={idx}
              className={cn(
                'my-2.5 rounded-xl overflow-hidden shadow-xs font-mono border',
                themeStyles?.isTerminalMode
                  ? 'border-white/10 bg-[#0e0f17]/90'
                  : 'border-zinc-700/60 bg-[#16161a]',
              )}
            >
              {/* 顶部终端栏：经典 Mac 红黄绿圆点 + 语言标签 + 高对比度复制按钮 */}
              <div
                className={cn(
                  'flex items-center justify-between px-3 py-1.5 select-none border-b',
                  themeStyles?.isTerminalMode
                    ? 'bg-white/[0.04] border-white/10'
                    : 'bg-[#202026] border-zinc-700/50',
                )}
              >
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/90 border border-[#e0443e]/40" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/90 border border-[#dea123]/40" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]/90 border border-[#1aab29]/40" />
                  </div>
                  <span className="text-[10.5px] font-medium text-zinc-300 tracking-wide">
                    {part.lang || 'bash'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onCopy(part.text)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-sans text-zinc-300 hover:text-white hover:bg-zinc-700/60 transition-all cursor-pointer"
                  title="复制代码"
                >
                  {isCopied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 text-zinc-400" />
                      <span>复制</span>
                    </>
                  )}
                </button>
              </div>

              {/* 代码展示区域 */}
              <pre className="p-3.5 text-[12px] leading-relaxed text-zinc-100 overflow-x-auto select-text selection:bg-primary/30">
                <code>{part.text}</code>
              </pre>
            </div>
          )
        }

        const html = renderMarkdown(part.text)
        return (
          <div
            key={idx}
            className="ai-chat-content text-xs leading-relaxed break-words"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </div>
  )
}

/**
 * AI 提议指令交互式安全执行卡片 (Option C Command Guard Execution Card)
 */
function CommandExecutionCard({
  card,
  messageId,
  onCopy,
  copiedCode,
  onExecute,
  onReject,
}: {
  card: AIAssistantExecutionCard
  messageId: string
  onCopy: (code: string) => void
  copiedCode: string | null
  onExecute: (msgId: string) => void
  onReject: (msgId: string) => void
}) {
  const { t } = useTranslation()
  const isInteractive = Boolean(card.decision?.isInteractive)
  const isBlocked = !isInteractive && (card.status === 'blocked' || !card.decision.allowed)
  const isPending = !isInteractive && card.status === 'pending'
  const isExecuting = card.status === 'executing'
  const isExecuted = card.status === 'executed'
  const isRejected = card.status === 'rejected'

  // 已执行的只读探针默认完全收起为极简单行药丸，避免长回显与大卡片刷屏
  const [isExpanded, setIsExpanded] = useState(!isExecuted)
  const [showOutput, setShowOutput] = useState(false)
  const isCopied = copiedCode === card.command

  // 当已执行且处于收起状态时，渲染紧凑的一行极简药丸栏 (默认收起，极大提升长对话体验)
  if (isExecuted && !isExpanded) {
    return (
      <div
        data-testid={`execution-card-${messageId}`}
        onClick={() => setIsExpanded(true)}
        className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10 dark:bg-emerald-950/20 transition-all px-3 py-1.5 flex items-center justify-between gap-2 text-xs cursor-pointer select-none group shadow-2xs"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="font-semibold text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
            {t('ai_card_status_executed') || '已安全执行'}
          </span>
          <span className="text-[10px] text-muted-foreground/80 truncate font-mono bg-black/20 dark:bg-black/40 px-2 py-0.5 rounded border border-border/40 max-w-[280px]">
            {card.command}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-[10.5px]">
          <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/20">
            {t('ai_card_safe_readonly_badge') || '只读白名单'}
          </span>
          <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium group-hover:underline">
            <span>{t('ai_card_expand_details') || '查看执行结果'}</span>
            <ChevronRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid={`execution-card-${messageId}`}
      className={cn(
        'mt-2.5 rounded-xl border p-3 space-y-2 text-xs transition-all shadow-2xs',
        isInteractive
          ? 'bg-sky-500/10 border-sky-500/30 text-foreground'
          : isBlocked
            ? 'bg-destructive/10 border-destructive/30 text-destructive dark:text-red-400'
            : isExecuting
              ? 'bg-amber-500/10 border-amber-500/30 text-foreground'
              : isExecuted
                ? 'bg-emerald-500/10 border-emerald-500/30 text-foreground'
                : isRejected
                  ? 'bg-muted/40 border-border/50 text-muted-foreground'
                  : 'bg-primary/8 border-primary/25 text-foreground',
      )}
    >
      {/* 头部标题与风险徽章 */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1.5 select-none">
        <div className="flex items-center gap-1.5">
          {isInteractive ? (
            <Terminal className="h-4 w-4 text-sky-500 shrink-0" />
          ) : isBlocked ? (
            <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
          ) : isExecuted ? (
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : isExecuting ? (
            <QshellLoader size="xs" />
          ) : isRejected ? (
            <ShieldAlert className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          )}

          <span className="font-semibold text-[11px] truncate">
            {isInteractive
              ? t('ai_card_status_interactive') || '交互式终端指令'
              : isBlocked
                ? t('ai_card_status_blocked') || '安全拦截阻断'
                : isExecuting
                  ? t('ai_card_status_executing') || '正在安全执行...'
                  : isExecuted
                    ? t('ai_card_status_executed') || '已安全执行'
                    : isRejected
                      ? t('ai_card_status_rejected') || '已拒绝执行'
                      : t('ai_card_status_pending') || '等待执行授权'}
          </span>
        </div>

        {/* 状态徽章 */}
        <div className="flex items-center gap-1 shrink-0">
          {isInteractive && (
            <span className="px-1.5 py-0.2 rounded-full text-[9.5px] bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium border border-sky-500/20">
              {t('ai_card_interactive_badge') || '需在终端交互运行'}
            </span>
          )}
          {card.decision.isReadOnly && (
            <span className="px-1.5 py-0.2 rounded-full text-[9.5px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium border border-emerald-500/20">
              {t('ai_card_safe_readonly_badge') || '只读白名单'}
            </span>
          )}
          {card.decision.reason.includes('深度') && (
            <span className="px-1.5 py-0.2 rounded-full text-[9.5px] bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium border border-blue-500/20">
              {t('ai_card_anti_hang_badge') || '防卡死限制'}
            </span>
          )}
          {isExecuted && (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground ml-1.5 cursor-pointer transition-colors"
            >
              <span>{t('ai_card_collapse_details') || '收起'}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 指令代码块 */}
      <div className="rounded-lg bg-[#18181b] dark:bg-[#121214] border border-border/40 overflow-hidden font-mono text-[11.5px]">
        <div className="flex items-center justify-between px-2.5 py-1 bg-zinc-800/60 border-b border-zinc-700/40 select-none">
          <span className="text-[10px] text-zinc-400">Shell Command</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                useAIStore.getState().openExplainShell(card.command)
              }}
              className="inline-flex items-center gap-0.5 text-[10px] text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
              title="乐高可视化拆解此命令"
            >
              <Layers className="h-2.5 w-2.5" />
              <span>拆解</span>
            </button>
            <button
              type="button"
              onClick={() => onCopy(card.command)}
              className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              {isCopied ? (
                <>
                  <Check className="h-2.5 w-2.5 text-emerald-400" />
                  <span className="text-emerald-400">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="h-2.5 w-2.5" />
                  <span>复制</span>
                </>
              )}
            </button>
          </div>
        </div>
        <pre className="p-2.5 text-zinc-100 overflow-x-auto selection:bg-primary/30">
          <code>{card.command}</code>
        </pre>
      </div>

      {/* 说明文本 */}
      {card.explanation && (
        <p className="text-[11px] text-muted-foreground leading-relaxed italic">
          💡 {card.explanation}
        </p>
      )}

      {/* 阻断原因 */}
      {isBlocked && (
        <div className="p-2 rounded-md bg-destructive/15 border border-destructive/25 text-[11px] text-destructive flex items-start gap-1.5 leading-snug">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{card.error || card.decision.reason || '该指令包含修改/删除/高危操作或无界递归，已由安全决策网关拦截阻断。'}</span>
        </div>
      )}

      {/* 危险模式：执行前置预览 + 全量审计标记 */}
      {card.dangerPreview && (
        <div className="p-2 rounded-md bg-destructive/10 border border-destructive/30 text-[11px] text-destructive space-y-1">
          <div className="flex items-start gap-1.5 leading-snug">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{card.dangerPreview}</span>
          </div>
          {card.dangerAudited && (
            <div className="pl-5 opacity-80">
              {t('ai_danger_mode_audit') || '已写入全量审计（policyLevel=danger）'}
            </div>
          )}
        </div>
      )}

      {/* 待授权操作按钮 */}
      {isPending && (
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className="text-[10px] text-muted-foreground truncate">
            {card.decision.adaptiveRetry
              ? (t('ai_card_adaptive_retry_hint', { seconds: Math.round(card.decision.adaptiveRetry.timeoutMs / 1000) }) || `${Math.round(card.decision.adaptiveRetry.timeoutMs / 1000)}s 未返回将自动改用浅深度查找`)
              : '🔒 严格防深度遍历卡死与修改保护'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`reject-cmd-${messageId}`}
              onClick={() => onReject(messageId)}
              className="h-6 px-2 text-[10.5px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3 mr-1" />
              <span>{t('ai_card_reject_btn') || '拒绝'}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid={`execute-cmd-${messageId}`}
              onClick={() => onExecute(messageId)}
              className="h-6 px-2.5 text-[10.5px] bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer shadow-2xs"
            >
              <Play className="h-3 w-3 mr-1 fill-current" />
              <span>{t('ai_card_execute_btn') || '允许执行并由 AI 分析'}</span>
            </Button>
          </div>
        </div>
      )}

      {/* 交互式指令操作按钮 (直通终端) */}
      {isInteractive && (
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className="text-[10px] text-muted-foreground truncate">
            {card.decision.blockedReason || 'ℹ️ 该指令属于常驻监控程序，适合在左侧主终端窗口中持续观察'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`insert-cmd-${messageId}`}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('insert-terminal-command', {
                    detail: { command: card.command, execute: false },
                  }),
                )
              }}
              className="h-6 px-2 text-[10.5px] text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <Terminal className="h-3 w-3 mr-1" />
              <span>{t('ai_insert_to_terminal_btn') || '填入终端'}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid={`run-terminal-cmd-${messageId}`}
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('insert-terminal-command', {
                    detail: { command: card.command, execute: true },
                  }),
                )
              }}
              className="h-6 px-2.5 text-[10.5px] bg-sky-600 hover:bg-sky-500 text-white font-medium cursor-pointer shadow-2xs"
            >
              <Play className="h-3 w-3 mr-1 fill-current" />
              <span>{t('ai_run_in_terminal_btn') || '在终端运行'}</span>
            </Button>
          </div>
        </div>
      )}

      {/* 终端执行分析深度总结 */}
      {isExecuted && card.summary && (
        <div
          data-testid="ai-card-summary"
          className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2 select-text"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {t('ai_card_summary_title') || '终端执行分析结论'}：
            </span>
            <p className="leading-relaxed font-sans">{card.summary}</p>
          </div>
        </div>
      )}

      {/* 已执行输出折叠展示 与 深度诊断触发 */}
      {isExecuted && card.output && (
        <div className="pt-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowOutput((prev) => !prev)}
              className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer select-none"
            >
              {showOutput ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span>{t('ai_card_output_title') || '终端输出结果'}</span>
            </button>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid={`deep-analyze-cmd-${messageId}`}
              onClick={() => {
                void useAIStore.getState().sendAssistantMessage(
                  `指令「${card.command}」已在服务器执行完毕，实际采样输出如下：\n\`\`\`\n${card.output}\n\`\`\`\n请基于此输出做进一步深度诊断，指出根本原因、潜在隐患与优化建议。`,
                )
              }}
              className="h-5 px-1.5 text-[10px] text-primary hover:bg-primary/10 font-medium cursor-pointer gap-1"
            >
              <Sparkles className="h-2.5 w-2.5 text-primary" />
              <span>{t('ai_card_deep_analyze_btn') || '让 AI 深度诊断此输出'}</span>
            </Button>
          </div>
          {showOutput && (
            <div className="max-h-40 overflow-y-auto rounded-md bg-[#141416] p-2 font-mono text-[11px] text-zinc-300 border border-zinc-700/50 select-text leading-relaxed whitespace-pre-wrap break-all">
              {card.output}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 判断 AI 回复是否属于未连接终端或未找到对应目标服务器的拦截引导信息
 */
export function isServerPickerNeeded(content: string): boolean {
  if (!content) return false
  const patterns = [
    // 1. 未连接终端提示 (各种常见句式)
    /未连接任何(?:活动)?(?:服务器)?终端/i,
    /未打开任何(?:活动)?(?:SSH)?终端/i,
    /当前未(?:打开|连接)(?:任何)?(?:SSH)?(?:终端|主机|服务器)/i,
    /当前处于首页.*未(?:打开|连接)/i,
    /未指定目标服务器.*未连接/i,
    // 2. 找不到指定服务器
    /未找到(?:指定|对应|名为)?.*?的服务器/i,
    /找不到(?:指定|对应|名为)?.*?的服务器/i,
    /无法确定(?:您想要)?(?:探测|排查|检查|连接)哪台(?:主机|服务器)/i,
    // 3. 引导选择服务器提示
    /请明确(?:回复|选择)要(?:排查|检查|体检|探测)哪台服务器/i,
    /请选择要(?:排查|检查|体检|探测)的服务器/i,
    /已纳管服务器资产清单/i,
    /无法直接执行服务器.*排查/i,
    // 4. 实操执行引导提示 (如末尾的采样建议、点选服务器下发等)
    /可在下方(?:卡片中)?(?:点击|点选|勾选|选择)(?:目标)?(?:主机|服务器)/i,
    /请在下方(?:卡片中)?(?:点击|点选|勾选|选择)(?:目标)?(?:主机|服务器)/i,
    /请告诉我目标服务器/i,
  ]
  return patterns.some((p) => p.test(content))
}

interface UnattachedServerPickerProps {
  userPrompt?: string
  onSelectSingle: (server: { id: string; name?: string; host: string }, userPrompt?: string) => void
  onSelectBatch: (servers: Array<{ id: string; name?: string; host: string }>, userPrompt?: string) => void
  onInspectAll: (userPrompt?: string) => void
}

function UnattachedServerPicker({
  userPrompt,
  onSelectSingle,
  onSelectBatch,
  onInspectAll,
}: UnattachedServerPickerProps) {
  const servers = useAppStore((s) => s.servers) || []
  const validServers = useMemo(
    // 仅按 BMC 形态排除；刻意不用 caps.probe，否则会连带排除 network/serial/telnet
    () => servers.filter((s) => !getServerConnectionFlags(s.targetType, s.protocol).isDeviceManagedServer),
    [servers],
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  if (validServers.length === 0) return null

  const handleToggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const handleSelectAllToggle = () => {
    if (selectedIds.length === validServers.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(validServers.map((s) => s.id))
    }
  }

  const selectedServers = validServers.filter((s) => selectedIds.includes(s.id))

  return (
    <div
      data-testid="unattached-server-picker"
      className="mt-2.5 p-3 rounded-xl border border-primary/25 bg-background/90 dark:bg-zinc-900/80 shadow-2xs space-y-2.5 backdrop-blur-xs"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span>快捷选择目标主机：</span>
          <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
            （点选主机一键发起实机排查）
          </span>
        </div>
        <button
          type="button"
          data-testid="btn-inspect-all-servers"
          onClick={() => onInspectAll(userPrompt)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 transition-all cursor-pointer"
        >
          <Activity className="h-3 w-3" />
          <span>一键巡检全部 ({validServers.length}台)</span>
        </button>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
        {validServers.map((s) => {
          const isSelected = selectedIds.includes(s.id)
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center justify-between p-2 rounded-lg border transition-all text-xs gap-2',
                isSelected
                  ? 'border-primary/50 bg-primary/10 dark:bg-primary/15'
                  : 'border-border/40 hover:border-border hover:bg-muted/50',
              )}
            >
              <label className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-0">
                <input
                  type="checkbox"
                  data-testid={`checkbox-server-${s.id}`}
                  checked={isSelected}
                  onChange={() => handleToggle(s.id)}
                  className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                />
                <span className="font-medium text-foreground truncate max-w-[120px]" title={s.name || s.host}>
                  {s.name || s.host}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground truncate" title={s.host}>
                  ({s.host})
                </span>
              </label>

              <button
                type="button"
                data-testid={`btn-probe-server-${s.id}`}
                onClick={() => onSelectSingle(s, userPrompt)}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-secondary hover:bg-primary hover:text-primary-foreground text-secondary-foreground transition-all cursor-pointer font-medium"
              >
                <span>单击排查</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
        <button
          type="button"
          data-testid="btn-toggle-select-all"
          onClick={handleSelectAllToggle}
          className="text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
        >
          {selectedIds.length === validServers.length ? '取消全选' : '全选所有'}
        </button>

        {selectedIds.length > 0 && (
          <button
            type="button"
            data-testid="btn-batch-probe-servers"
            onClick={() => onSelectBatch(selectedServers, userPrompt)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium shadow-2xs hover:opacity-90 transition-all cursor-pointer"
          >
            <Rocket className="h-3 w-3" />
            <span>批量排查已选 ({selectedIds.length}台)</span>
          </button>
        )}
      </div>
    </div>
  )
}

export function FloatingAIAssistant() {
  const { t } = useTranslation()
  const {
    enableAiGlobal,
    showFloatingMascot,
    isFloatingAssistantOpen,
    openFloatingAssistant,
    closeFloatingAssistant,
    assistantMode,
    setAssistantMode,
    assistantMessages,
    isAssistantResponding,
    stopAssistantResponding,
    assistantInput,
    setAssistantInput,
    assistantMascotMood,
    sendAssistantMessage,
    assistantSessions,
    currentAssistantSessionId,
    createNewAssistantSession,
    loadAssistantSession,
    deleteAssistantSession,
    clearAllAssistantSessions,
    executeMessageCommand,
    rejectMessageCommand,
    configuredProviders,
    settings,
    dangerModeActive,
    deactivateDangerMode,
    isMascotMinimized,
    mascotPeekY,
    setMascotMinimized,
  } = useAIStore()

  // 危险模式由用户手动开启/关闭，时间与会话变化都不会让它失效

  const isAiConfigured = useMemo(
    () => hasActiveAIProvider(configuredProviders, settings),
    [configuredProviders, settings],
  )

  // 终端场景配色联动：处于终端模块时，小助手窗口配色无缝跟随终端右键菜单；处于其他界面时保持原有设计
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tabs = useAppStore((s) => s.tabs)
  const activeTab = useMemo(() => tabs?.find((t) => t.id === activeTabId), [tabs, activeTabId])
  const isInTerminal = Boolean(activeTab && activeTab.module === 'terminal')
  const terminalThemeId = useAppStore((s) => s.terminalThemeId)
  const customTerminalThemes = useAppStore((s) => s.customTerminalThemes)
  const terminalThemeOverrides = useAppStore((s) => s.terminalThemeOverrides)

  const activeTerminalTheme = useMemo(() => {
    if (!isInTerminal || !terminalThemeId) return null
    try {
      return getTerminalTheme(terminalThemeId, customTerminalThemes, terminalThemeOverrides)
    } catch {
      return null
    }
  }, [isInTerminal, terminalThemeId, customTerminalThemes, terminalThemeOverrides])

  const isLightTerminal = activeTerminalTheme?.type === 'light'
  const appTheme = useAppStore((s) => s.theme)

  // 智能识别当前环境是否为浅色模式 (终端模式由终端主题/底色判定，非终端由应用系统主题判定)
  const isMascotLight = useMemo(() => {
    if (isInTerminal && activeTerminalTheme) {
      if (activeTerminalTheme.type === 'light') return true
      const bg = activeTerminalTheme.ui?.background
      if (bg && bg.startsWith('#') && bg.length >= 7) {
        const r = parseInt(bg.slice(1, 3), 16) || 0
        const g = parseInt(bg.slice(3, 5), 16) || 0
        const b = parseInt(bg.slice(5, 7), 16) || 0
        if ((0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55) return true
      }
      return false
    }
    if (appTheme === 'light') return true
    if (appTheme === 'dark') return false
    if (typeof window !== 'undefined' && window.matchMedia) {
      return !window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  }, [isInTerminal, activeTerminalTheme, appTheme])

  // 提取终端主题专属荧光色 (优先提取终端 brightCyan / cyan / cursor，未处于终端则使用标准赛博青色)
  const terminalMascotAccent = useMemo(() => {
    if (!isInTerminal || !activeTerminalTheme) return '#38bdf8'
    return (
      activeTerminalTheme.ansi?.brightCyan ||
      activeTerminalTheme.ansi?.cyan ||
      activeTerminalTheme.ui?.cursor ||
      '#38bdf8'
    )
  }, [isInTerminal, activeTerminalTheme])

  // 依据当前所在界面（终端 vs 其他界面）及终端明暗主题计算弹框各区域的配色风格
  const themeStyles = useMemo(() => {
    if (!isInTerminal) {
      return {
        isTerminalMode: false,
        dialogContainer: 'bg-background/97 backdrop-blur-2xl border border-border/60 shadow-[0_0_0_1px_rgba(56,189,248,0.30),0_18px_48px_-12px_rgba(15,23,42,0.32),0_0_30px_-10px_rgba(56,189,248,0.40)] dark:shadow-[0_0_0_1px_rgba(56,189,248,0.38),0_20px_55px_-12px_rgba(0,0,0,0.85),0_0_34px_-10px_rgba(56,189,248,0.45)] text-foreground',
        header: 'border-b border-border/50 bg-background/40 text-foreground',
        headerBtn: 'hover:bg-muted/70 text-muted-foreground hover:text-foreground active:scale-95 transition-colors',
        copilotBadge: 'bg-primary/10 text-primary border border-primary/15 font-medium',
        welcomeBanner: 'bg-muted/30 border-border/40',
        welcomeTitle: 'text-foreground',
        welcomeSub: 'text-muted-foreground',
        cardTitle: 'text-foreground',
        cardDesc: 'text-muted-foreground',
        iconBox: 'bg-primary/10 border border-primary/10 text-primary',
        pillText: 'text-inherit',
        disclaimerText: 'text-muted-foreground/55',
        body: 'bg-transparent text-foreground',
        userBubble: 'bg-primary/15 border border-primary/20 text-foreground rounded-tr-sm font-normal',
        userAvatar: 'bg-primary/15 border border-primary/20 text-primary font-semibold',
        aiBubble: 'bg-transparent text-foreground',
        aiBubbleHeader: 'text-muted-foreground/70',
        inputBar: 'border-t border-border/50 bg-background/60',
        inputCard: 'border border-border/60 bg-muted/25 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/40 focus-within:bg-background/60 text-foreground placeholder:text-muted-foreground/60',
        historyPanel: 'bg-background/98 backdrop-blur-2xl border-border/50 text-foreground',
        recommendPill: 'bg-muted/40 hover:bg-primary/10 hover:text-primary text-muted-foreground border-border/40 hover:border-primary/25',
        modePillContainer: 'bg-muted/50 border-border/40',
        modeBtnActive: 'bg-background text-foreground shadow-sm font-semibold',
        modeBtnInactive: 'text-muted-foreground hover:text-foreground',
        sendBtnActive: 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all',
        sendBtnDisabled: 'bg-muted text-muted-foreground/40 cursor-not-allowed',
        copyActionBtn: 'hover:bg-muted text-muted-foreground hover:text-foreground active:scale-95 transition-all',
      }
    }

    if (isLightTerminal) {
      // 终端明亮主题模式：跟随亮色终端右键菜单风格，保持与应用主题一致的层级
      return {
        isTerminalMode: true,
        dialogContainer: 'bg-white/96 backdrop-blur-xl border border-slate-200 shadow-[0_0_0_1px_rgba(56,189,248,0.32),0_18px_45px_-12px_rgba(15,23,42,0.28),0_0_28px_-12px_rgba(56,189,248,0.40)] text-slate-800',
        header: 'border-b border-slate-200/80 bg-slate-50/60 text-slate-800',
        headerBtn: 'hover:bg-slate-100 text-slate-500 hover:text-slate-900 active:scale-95 transition-colors',
        copilotBadge: 'bg-sky-50 text-sky-700 border border-sky-200/80',
        welcomeBanner: 'bg-slate-50 border-slate-200/80',
        welcomeTitle: 'text-slate-900',
        welcomeSub: 'text-slate-500',
        cardTitle: 'text-slate-800',
        cardDesc: 'text-slate-500',
        iconBox: 'bg-sky-50 border border-sky-100 text-sky-600',
        pillText: 'text-slate-700 font-medium',
        disclaimerText: 'text-slate-400',
        body: 'bg-transparent text-slate-800',
        userBubble: 'bg-sky-50 border border-sky-200/80 text-slate-800 rounded-tr-sm font-normal',
        userAvatar: 'bg-sky-100 text-sky-700 font-semibold',
        aiBubble: 'bg-transparent text-slate-800',
        aiBubbleHeader: 'text-slate-400',
        inputBar: 'border-t border-slate-200/80 bg-white/70',
        inputCard: 'border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-sky-500/20 focus-within:border-sky-400 text-slate-800 placeholder:text-slate-400',
        historyPanel: 'bg-white/98 backdrop-blur-xl border-slate-200/80 text-slate-800',
        recommendPill: 'bg-slate-900/[0.04] hover:bg-sky-500/10 hover:text-sky-700 text-slate-600 border-slate-200/80 hover:border-sky-400/40',
        modePillContainer: 'bg-slate-900/[0.05] border-slate-200/60',
        modeBtnActive: 'bg-white text-slate-800 shadow-sm font-semibold border border-slate-200/60',
        modeBtnInactive: 'text-slate-500 hover:text-slate-800',
        sendBtnActive: 'bg-sky-600 text-white hover:bg-sky-500 active:scale-95 transition-all',
        sendBtnDisabled: 'bg-slate-100 text-slate-400 cursor-not-allowed',
        copyActionBtn: 'hover:bg-slate-100 text-slate-500 hover:text-slate-800 active:scale-95 transition-all',
      }
    }

    // 终端暗色主题模式：低对比中性面板 + 单一 sky 强调色，弱化装饰性发光与渐变
    return {
      isTerminalMode: true,
      dialogContainer: 'dark bg-[#1c2030]/97 backdrop-blur-2xl border border-white/[0.10] shadow-[0_0_0_1px_rgba(56,189,248,0.32),0_20px_55px_-12px_rgba(0,0,0,0.85),0_0_34px_-8px_rgba(56,189,248,0.40)] text-slate-100',
      header: 'border-b border-white/[0.08] bg-white/[0.02] text-slate-100',
      headerBtn: 'hover:bg-white/[0.08] text-slate-400 hover:text-white active:scale-95 transition-colors',
      copilotBadge: 'bg-sky-500/12 text-sky-300 border border-sky-400/20',
      welcomeBanner: 'bg-white/[0.04] border-white/[0.08]',
      welcomeTitle: 'text-white font-semibold',
      welcomeSub: 'text-slate-400',
      cardTitle: 'text-slate-100 font-medium',
      cardDesc: 'text-slate-400',
      iconBox: 'bg-sky-500/12 border border-sky-400/15 text-sky-300',
      pillText: 'text-slate-200',
      disclaimerText: 'text-slate-500',
      body: 'bg-transparent text-slate-100',
      userBubble: 'bg-sky-500/15 border border-sky-400/20 text-slate-100 rounded-tr-sm font-normal',
      userAvatar: 'bg-sky-500/15 border border-sky-400/20 text-sky-300 font-semibold',
      aiBubble: 'bg-transparent text-slate-200',
      aiBubbleHeader: 'text-slate-500',
      inputBar: 'border-t border-white/[0.08] bg-black/10',
      inputCard: 'border border-white/[0.10] bg-black/20 focus-within:border-sky-400/40 focus-within:bg-black/30 focus-within:ring-2 focus-within:ring-sky-400/15 text-slate-100 placeholder:text-slate-500',
      historyPanel: 'bg-[#1c2030]/98 backdrop-blur-2xl border-white/[0.10] text-slate-100',
      recommendPill: 'bg-white/[0.05] hover:bg-sky-500/10 hover:text-sky-300 text-slate-300 border-white/[0.08] hover:border-sky-400/25',
      modePillContainer: 'bg-white/[0.05] border-white/[0.08]',
      modeBtnActive: 'bg-white/[0.12] text-white shadow-sm font-semibold',
      modeBtnInactive: 'text-slate-400 hover:text-slate-200',
      sendBtnActive: 'bg-sky-500 text-white hover:bg-sky-400 active:scale-95 transition-all',
      sendBtnDisabled: 'bg-white/[0.06] text-slate-500 border border-white/5 cursor-not-allowed',
      copyActionBtn: 'hover:bg-white/10 text-slate-400 hover:text-slate-200 active:scale-95 transition-all',
    }
  }, [isInTerminal, isLightTerminal])

  const { toast } = useToast()
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<AIAssistantContextMenuState | null>(null)
  const [mascotMenu, setMascotMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialogSize, setDialogSize] = useState<{ width: number; height: number } | null>(null)
  const [isDialogResizing, setIsDialogResizing] = useState(false)
  const dialogResizeRef = useRef<{
    startX: number
    startY: number
    startW: number
    startH: number
    startPosX: number
    startPosY: number
    direction: ResizeDirection
  }>({
    startX: 0,
    startY: 0,
    startW: 420,
    startH: 600,
    startPosX: 0,
    startPosY: 0,
    direction: 'se',
  })
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isChatUserScrolledUpRef = useRef<boolean>(false)
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 1. 小人位置（始终相对窗口右下角定位，缩放全屏不漂移）
  const [mascotOffset, setMascotOffset] = useState<MascotOffset>(loadSavedMascotOffset)
  const [isMascotDragging, setIsMascotDragging] = useState(false)
  const mascotDragRef = useRef<{
    startX: number
    startY: number
    startRight: number
    startBottom: number
    hasMoved: boolean
  }>({
    startX: 0,
    startY: 0,
    startRight: 28,
    startBottom: 48,
    hasMoved: false,
  })

  // 2. 弹窗卡片自由拖拽位置管理
  const [dialogPosition, setDialogPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDialogDragging, setIsDialogDragging] = useState(false)
  const dialogDragRef = useRef<{
    startX: number
    startY: number
    dialogStartX: number
    dialogStartY: number
  }>({
    startX: 0,
    startY: 0,
    dialogStartX: 0,
    dialogStartY: 0,
  })

  // 窗口 resize 时安全校验与响应式重绘 (确保小人永远不进入标题栏和页脚)
  const [, setResizeTick] = useState(0)
  useEffect(() => {
    // 挂载时立即执行一次坐标校准，防止旧 localStorage 缓存异常坐标停留在顶栏
    setMascotOffset((prev) => clampMascotOffset(prev))

    const handleResize = () => {
      setResizeTick((t) => t + 1)
      setMascotOffset((prev) => clampMascotOffset(prev))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 重置弹窗卡片位置与尺寸（回到贴合小人的默认初始状态）
  const resetDialogCardPosition = () => {
    setDialogPosition(null)
    setDialogSize(null)
  }

  // 退出并关闭 AI 助手弹窗（统一重置卡片位置与尺寸、关闭历史抽屉、关闭右键菜单、播放关闭音效）
  const handleExitAssistant = () => {
    playSound(SoundType.Close)
    resetDialogCardPosition()
    setShowHistoryPanel(false)
    setContextMenu(null)
    closeFloatingAssistant()
  }

  useEffect(() => {
    if (!isFloatingAssistantOpen) {
      setContextMenu(null)
    }
  }, [isFloatingAssistantOpen])

  // 快捷键支持：Ctrl+Alt+A / Cmd+Alt+A 切换 AI 助手，Esc 退出或收起历史
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enableAiGlobal) return
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        if (isFloatingAssistantOpen) {
          handleExitAssistant()
        } else {
          resetDialogCardPosition()
          playSound(SoundType.Open)
          openFloatingAssistant()
        }
      } else if (e.key === 'Escape' && isFloatingAssistantOpen) {
        if (isAssistantResponding) {
          stopAssistantResponding()
          playSound(SoundType.Click)
          return
        }
        if (showHistoryPanel) {
          setShowHistoryPanel(false)
          return
        }
        handleExitAssistant()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    enableAiGlobal,
    isFloatingAssistantOpen,
    isAssistantResponding,
    stopAssistantResponding,
    showHistoryPanel,
    openFloatingAssistant,
    closeFloatingAssistant,
  ])

  // 自动滚动到最新消息 (类似终端追踪机制：正在输出或有新消息时，未向上滚动则自动追踪最新行；用户向上滚动后锁定停留；滑回底部恢复追踪)
  useEffect(() => {
    if (isFloatingAssistantOpen && assistantMessages.length > 0) {
      if (!isChatUserScrolledUpRef.current && messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }
  }, [assistantMessages, isAssistantResponding, isFloatingAssistantOpen])

  // 当新一轮响应开始时，重置滑动锁以自动追踪最新回答
  useEffect(() => {
    if (isAssistantResponding) {
      isChatUserScrolledUpRef.current = false
      setShowScrollBottomBtn(false)
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }
  }, [isAssistantResponding])

  // 弹窗显隐状态变更时：重置卡片位置与尺寸、关闭历史抽屉（打开时聚焦输入框并追踪最新）
  useEffect(() => {
    resetDialogCardPosition()
    setShowHistoryPanel(false)
    if (isFloatingAssistantOpen) {
      isChatUserScrolledUpRef.current = false
      setShowScrollBottomBtn(false)
      setTimeout(() => {
        textareaRef.current?.focus()
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
      }, 150)
    }
  }, [isFloatingAssistantOpen])

  // 输入框自适应高度调整 (最小 28px，最大 120px，自适应内容多行)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 28), 120)}px`
    }
  }, [assistantInput])

  // 智能指令拆解意图嗅探 (用户在输入框粘贴/输入复合管道命令时给予视觉提示)
  const detectedInputIntent = useMemo(() => {
    if (!assistantInput.trim()) return null
    return detectUserIntent(assistantInput)
  }, [assistantInput])



  // 点击助手小人图标切换显隐状态（退出时重置卡片位置）
  const handleToggle = () => {
    if (isFloatingAssistantOpen) {
      handleExitAssistant()
    } else {
      resetDialogCardPosition()
      playSound(SoundType.Open)
      openFloatingAssistant()
    }
  }

  // 鼠标拖拽小人事件（按右/底相对偏移拖动；拖到右边应用边界松手即隐藏）
  const handleMascotPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    let reachedRightEdge = false
    let lastPointerY = e.clientY

    mascotDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startRight: mascotOffset.right,
      startBottom: mascotOffset.bottom,
      hasMoved: false,
    }

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = moveEv.clientX - mascotDragRef.current.startX
      const dy = moveEv.clientY - mascotDragRef.current.startY

      // 一直往右拖到应用边界时记录当前鼠标高度，松手后隐藏到该高度
      reachedRightEdge = moveEv.clientX >= window.innerWidth - 10
      lastPointerY = moveEv.clientY

      if (!mascotDragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        mascotDragRef.current.hasMoved = true
        setIsMascotDragging(true)
      }

      if (mascotDragRef.current.hasMoved) {
        const next = clampMascotOffset({
          right: mascotDragRef.current.startRight - dx,
          bottom: mascotDragRef.current.startBottom - dy,
        })
        setMascotOffset(next)
      }
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      if (mascotDragRef.current.hasMoved) {
        setIsMascotDragging(false)
        if (reachedRightEdge) {
          // 恢复拖动前的停靠点，隐藏态探头停在鼠标当前高度
          const original = {
            right: mascotDragRef.current.startRight,
            bottom: mascotDragRef.current.startBottom,
          }
          setMascotOffset(original)
          saveMascotOffset(original)
          setMascotMinimized(true, clampMascotPeekY(lastPointerY))
          playSound(SoundType.Click)
        } else {
          setMascotOffset((latest) => {
            saveMascotOffset(latest)
            return latest
          })
        }
      } else {
        handleToggle()
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 双击吉祥物小人：重置小人停靠至右下角默认初始位置，并重置卡片位置
  const handleMascotDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const def = { right: 28, bottom: 48 }
    setMascotOffset(def)
    saveMascotOffset(def)
    resetDialogCardPosition()
    playSound(SoundType.Click)
  }

  // 小人右键菜单：打开 / 配置 / 关闭（隐藏）/ 重置位置
  const handleMascotContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu(null)
    setMascotMenu({ x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!mascotMenu) return
    const close = () => setMascotMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
    }
  }, [mascotMenu])

  const closeMascotMenu = () => setMascotMenu(null)

  const handleMascotMenuToggleAssistant = () => {
    closeMascotMenu()
    if (isFloatingAssistantOpen) {
      playSound(SoundType.Close)
      closeFloatingAssistant()
      return
    }
    setMascotMinimized(false)
    resetDialogCardPosition()
    playSound(SoundType.Open)
    openFloatingAssistant()
  }

  const handleMascotMenuConfig = () => {
    closeMascotMenu()
    window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai' }))
  }

  const handleMascotMenuReset = () => {
    closeMascotMenu()
    const def = { right: 28, bottom: 48 }
    setMascotOffset(def)
    saveMascotOffset(def)
    resetDialogCardPosition()
    playSound(SoundType.Click)
  }

  const handleMascotMenuDisableAi = () => {
    closeMascotMenu()
    useAIStore.getState().setEnableAiGlobal(false)
    playSound(SoundType.Click)
    toast.info(t('ai_mascot_menu_disable_ai_tip') || '已关闭 AI 总开关，可在 设置 → AI 中重新开启')
  }

  // 隐藏态探头：点击或按住拖动都会让小人恢复到鼠标位置
  const restoreFromPeek = (clientX: number, clientY: number) => {
    if (!useAIStore.getState().isMascotMinimized) return
    const next = clampMascotOffset({
      right: Math.max(16, window.innerWidth - clientX - MASCOT_SIZE / 2),
      bottom: Math.max(40, window.innerHeight - clientY - MASCOT_SIZE / 2),
    })
    setMascotOffset(next)
    saveMascotOffset(next)
    setMascotMinimized(false)
    playSound(SoundType.Open)
  }

  // 计算弹窗当前尺寸 (上下严格限制在主内容区到页脚之间，宽度由用户自由拉伸，不再受 1/3 比例限制)
  const getDialogDimensions = () => {
    if (typeof window === 'undefined') {
      return { width: 420, height: 600 }
    }

    // 主内容区域可用高度（上面到主内容区 44px，下面到页脚 32px）
    const availableHeight = Math.max(300, window.innerHeight - CONTENT_TOP_OFFSET - STATUSBAR_BOTTOM_OFFSET)
    const maxAllowedWidth = Math.max(320, window.innerWidth - 24)

    if (dialogSize !== null) {
      // 用户自定义拉伸尺寸，上下仍受主内容区与页脚严格限制
      const clampedWidth = Math.min(Math.max(320, dialogSize.width), maxAllowedWidth)
      const clampedHeight = Math.min(Math.max(300, dialogSize.height), availableHeight)
      return { width: clampedWidth, height: clampedHeight }
    }

    // 默认初始尺寸 (最高 600px，但不超过可用高度；默认宽 420px)
    const defaultH = Math.min(600, availableHeight)
    const defaultW = Math.min(420, maxAllowedWidth)

    return {
      width: defaultW,
      height: defaultH,
    }
  }

  // 计算弹窗生效坐标（支持拖拽定位、上下严格限制在主内容区到页脚之间）
  const getEffectiveDialogPosition = () => {
    const { width: dialogW, height: dialogH } = getDialogDimensions()

    if (typeof window === 'undefined') {
      return { x: 100, y: 100, width: dialogW, height: dialogH }
    }

    // 上下边界约束（上面到主内容区 44px，下面到页脚 32px）
    const minY = CONTENT_TOP_OFFSET
    const maxY = Math.max(minY, window.innerHeight - STATUSBAR_BOTTOM_OFFSET - dialogH)

    if (dialogPosition !== null) {
      const clampedX = Math.min(Math.max(12, dialogPosition.x), Math.max(12, window.innerWidth - dialogW - 12))
      const clampedY = Math.min(Math.max(minY, dialogPosition.y), maxY)
      return { x: clampedX, y: clampedY, width: dialogW, height: dialogH }
    }

    // 默认初始小窗口位置：紧密贴合小人，上下限制在主内容区到页脚之间
    const mascotLeft = window.innerWidth - mascotOffset.right - MASCOT_SIZE
    const mascotTop = window.innerHeight - mascotOffset.bottom - MASCOT_SIZE

    let defaultX = 0
    let defaultY = 0

    if (mascotLeft > window.innerWidth / 2) {
      defaultX = Math.max(16, mascotLeft + MASCOT_SIZE - dialogW)
    } else {
      defaultX = Math.min(window.innerWidth - dialogW - 16, mascotLeft)
    }

    if (mascotTop > window.innerHeight / 2) {
      defaultY = Math.min(maxY, Math.max(minY, mascotTop - dialogH - 14))
    } else {
      defaultY = Math.min(maxY, Math.max(minY, mascotTop + MASCOT_SIZE + 14))
    }

    return { x: defaultX, y: defaultY, width: dialogW, height: dialogH }
  }

  // 弹窗顶部栏拖拽移动事件 (上下坐标严格限制在主内容区到页脚之间)
  const handleDialogHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    const cur = getEffectiveDialogPosition()
    dialogDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      dialogStartX: cur.x,
      dialogStartY: cur.y,
    }
    setIsDialogDragging(true)

    const onPointerMove = (moveEv: PointerEvent) => {
      const dx = moveEv.clientX - dialogDragRef.current.startX
      const dy = moveEv.clientY - dialogDragRef.current.startY

      const { width: curW, height: curH } = getDialogDimensions()
      const minY = CONTENT_TOP_OFFSET
      const maxY = Math.max(minY, window.innerHeight - STATUSBAR_BOTTOM_OFFSET - curH)

      const nextX = Math.min(
        Math.max(12, dialogDragRef.current.dialogStartX + dx),
        Math.max(12, window.innerWidth - curW - 12),
      )
      const nextY = Math.min(
        Math.max(minY, dialogDragRef.current.dialogStartY + dy),
        maxY,
      )

      setDialogPosition({ x: nextX, y: nextY })
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setIsDialogDragging(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 弹窗边缘与角落拉伸调整宽高 (上下严格限制在主内容区到页脚之间，宽度无 1/3 限制)
  const handleResizePointerDown = (dir: ResizeDirection, e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    const cur = getEffectiveDialogPosition()
    dialogResizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: cur.width,
      startH: cur.height,
      startPosX: cur.x,
      startPosY: cur.y,
      direction: dir,
    }
    setIsDialogResizing(true)

    const onPointerMove = (moveEv: PointerEvent) => {
      const { startX, startY, startW, startH, startPosX, startPosY, direction } = dialogResizeRef.current
      const dx = moveEv.clientX - startX
      const dy = moveEv.clientY - startY
      const vw = window.innerWidth
      const vh = window.innerHeight

      const availableHeight = Math.max(300, vh - CONTENT_TOP_OFFSET - STATUSBAR_BOTTOM_OFFSET)
      const maxAllowedWidth = Math.max(320, vw - 24)

      let newW = startW
      let newH = startH
      let newX = startPosX
      let newY = startPosY

      // 1. 宽度计算 (无 1/3 屏幕限制)
      if (direction.includes('e')) {
        // 向右拉伸：如果碰到屏幕右边缘，向左平移释放扩展空间
        newW = Math.min(Math.max(320, startW + dx), maxAllowedWidth)
        if (newX + newW > vw - 12) {
          newX = Math.max(12, vw - 12 - newW)
        }
      } else if (direction.includes('w')) {
        // 向左拉伸：向左展开
        newW = Math.min(Math.max(320, startW - dx), maxAllowedWidth)
        newX = Math.max(12, startPosX + (startW - newW))
      }

      // 2. 高度计算 (上下严格受限于 CONTENT_TOP_OFFSET 与 STATUSBAR_BOTTOM_OFFSET)
      if (direction.includes('s')) {
        // 向下拉伸：如果碰到页脚，向上平移释放空间（但顶部不穿透 CONTENT_TOP_OFFSET）
        newH = Math.min(Math.max(300, startH + dy), availableHeight)
        const maxBottom = vh - STATUSBAR_BOTTOM_OFFSET
        if (newY + newH > maxBottom) {
          newY = Math.max(CONTENT_TOP_OFFSET, maxBottom - newH)
        }
      } else if (direction.includes('n')) {
        // 向上拉伸：向上展开，顶部严格受限于 CONTENT_TOP_OFFSET
        newH = Math.min(Math.max(300, startH - dy), availableHeight)
        newY = Math.max(CONTENT_TOP_OFFSET, startPosY + (startH - newH))
      }

      setDialogSize({ width: newW, height: newH })
      setDialogPosition({ x: newX, y: newY })
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setIsDialogResizing(false)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const handleChatScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const threshold = 40
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
    isChatUserScrolledUpRef.current = !isNearBottom
    if (isNearBottom) {
      setShowScrollBottomBtn(false)
    } else {
      setShowScrollBottomBtn(el.scrollHeight > el.clientHeight + 80)
    }
  }

  const scrollToBottom = () => {
    isChatUserScrolledUpRef.current = false
    setShowScrollBottomBtn(false)
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }

  const handleSend = () => {
    if (!assistantInput.trim() || isAssistantResponding) return
    isChatUserScrolledUpRef.current = false
    setShowScrollBottomBtn(false)
    playSound(SoundType.Click)
    void sendAssistantMessage()
  }

  const handleKeyDownInInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCode(cmd)
    playSound(SoundType.Click)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const handleCopyMessage = (msgId: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedMessageId(msgId)
    playSound(SoundType.Click)
    setTimeout(() => {
      setCopiedMessageId((cur) => (cur === msgId ? null : cur))
    }, 2000)
  }

  // 右键菜单交互兜底：支持划选教程文字、点击代码块或消息时快速唤起「复制」、「在当前终端执行」、「填入当前终端」
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // 1. 获取选中文本（兼容普通文本选区与 textarea/input 内部选区）
    const target = e.target as HTMLElement | null
    let rawSel = window.getSelection()?.toString() || ''
    if (!rawSel.trim() && (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
      const start = target.selectionStart ?? 0
      const end = target.selectionEnd ?? 0
      if (end > start) {
        rawSel = target.value.slice(start, end)
      }
    }
    const selectedText = rawSel.trim()

    let targetText = selectedText
    let isCode = false
    let isFullMessage = false
    const hasSelection = Boolean(selectedText)

    // 2. 若未划选，则检测是否右键点击在代码块或消息气泡上
    if (!targetText && target) {
      const codeEl = target.closest('pre, code')
      if (codeEl?.textContent?.trim()) {
        targetText = codeEl.textContent.trim()
        isCode = true
      } else {
        const msgEl = target.closest('.ai-chat-content, [data-message-content]')
        if (msgEl?.textContent?.trim()) {
          targetText = msgEl.textContent.trim()
          isFullMessage = true
        }
      }
    }

    if (!targetText) {
      setContextMenu(null)
      return
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      text: targetText,
      isCode,
      isFullMessage,
      hasSelection,
    })
  }

  const handleExecuteInTerminal = (cmd: string) => {
    if (!isInTerminal) {
      toast.warning(t('ai_ctx_not_in_terminal') || '当前未处于终端窗口')
      return
    }
    window.dispatchEvent(
      new CustomEvent('insert-terminal-command', {
        detail: { command: cmd, execute: true },
      }),
    )
    window.dispatchEvent(new CustomEvent('focus-active-terminal'))
    toast.success(t('ai_ctx_executed_in_terminal') || '已发送至终端执行')
    playSound(SoundType.Click)
  }

  const handleInsertToTerminal = (cmd: string) => {
    if (!isInTerminal) {
      toast.warning(t('ai_ctx_not_in_terminal') || '当前未处于终端窗口')
      return
    }
    window.dispatchEvent(
      new CustomEvent('insert-terminal-command', {
        detail: { command: cmd, execute: false },
      }),
    )
    window.dispatchEvent(new CustomEvent('focus-active-terminal'))
    toast.info(t('ai_ctx_inserted_to_terminal') || '已填入当前终端')
    playSound(SoundType.Click)
  }

  const handleCopyFromContextMenu = (textToCopy: string) => {
    try {
      navigator.clipboard.writeText(textToCopy)
      setCopiedCode(textToCopy)
      toast.success(t('ai_ctx_copied') || '已复制到剪贴板')
      playSound(SoundType.Click)
    } catch {
      /* ignore */
    }
  }

  // 划选快捷弹框定时器与监听：像终端一样划选/复制完直接弹出「复制/在当前终端执行/填入当前终端」
  const selectionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current)
      }
    }
  }, [])

  const isSelectingInDialogRef = useRef(false)

  const handleDialogMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      isSelectingInDialogRef.current = true
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current)
        selectionTimerRef.current = null
      }
    }
  }

  const handleDialogMouseUp = useCallback((e: React.MouseEvent | MouseEvent) => {
    // 关键：仅左键 (button === 0) 释放时触发划词浮动条；右键或中键由 handleContextMenu 或原生事件接管
    if (e.button !== 0) {
      return
    }

    // 拖拽窗口或缩放窗口中不触发划选浮条
    if (isDialogDragging || isDialogResizing) {
      return
    }

    const target = e.target as HTMLElement | null
    // 若在输入框内部划选，避免遮挡用户打字输入与光标定位
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      return
    }

    // 如果全局终端划词工具条关闭了，不主动弹出
    const toolbarEnabled = useAppStore.getState().terminalSelectionToolbar ?? true
    if (!toolbarEnabled) {
      return
    }

    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current)
    }

    const clientX = e.clientX
    const clientY = e.clientY

    // 延时 25ms 确保 DOM 选区稳定
    selectionTimerRef.current = window.setTimeout(() => {
      selectionTimerRef.current = null

      const rawSel = window.getSelection()?.toString() || ''
      const selectedText = rawSel.trim()

      if (selectedText.length > 0) {
        // 若开启了「划选文本自动复制」(terminalCopyPaste)，同步复制至剪贴板
        if (useAppStore.getState().terminalCopyPaste ?? false) {
          try {
            navigator.clipboard.writeText(selectedText)
          } catch {
            /* ignore */
          }
        }

        let targetX = clientX
        let targetY = clientY
        try {
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            if (rect.width > 0 || rect.height > 0) {
              targetX = rect.right
              targetY = rect.bottom
            }
          }
        } catch {
          /* fallback to clientX, clientY */
        }

        const isCode = Boolean(target?.closest('pre, code'))
        setContextMenu({
          x: targetX,
          y: targetY,
          text: selectedText,
          isCode,
          hasSelection: true,
        })
      }
    }, 25)
  }, [isDialogDragging, isDialogResizing])

  // 全局鼠标抬起监听：无论鼠标拖拽至何处（即使滑出助手面板甚至应用外），松手即触发
  useEffect(() => {
    if (!isFloatingAssistantOpen) return

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (!isSelectingInDialogRef.current) return
      isSelectingInDialogRef.current = false
      if (e.button === 0) {
        handleDialogMouseUp(e)
      }
    }

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (isSelectingInDialogRef.current && e.buttons === 0) {
        isSelectingInDialogRef.current = false
        handleDialogMouseUp(e)
      }
    }

    window.addEventListener('mouseup', handleWindowMouseUp)
    window.addEventListener('mousemove', handleWindowMouseMove)

    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp)
      window.removeEventListener('mousemove', handleWindowMouseMove)
    }
  }, [isFloatingAssistantOpen, handleDialogMouseUp])

  const CAPABILITY_CARDS = [
    {
      id: 'cluster_inspect',
      title: '巡检所有服务器',
      desc: '全量纳管服务器健康体检与大盘指标',
      prompt: '帮我全面巡检已纳管的所有服务器，排查是否有高负载、磁盘爆满或异常节点。',
      icon: Activity,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20',
    },
    {
      id: 'monitor',
      title: '高占用排查',
      desc: '谁在吃内存/CPU？现场定位真凶进程',
      prompt: '请帮我排查当前服务器内存和 CPU 占用最高的是哪些进程？是否存在异常内存泄漏或僵尸进程？',
      icon: Cpu,
      color: 'text-indigo-400',
      bgColor: 'bg-indigo-500/10 hover:bg-indigo-500/15 border-indigo-500/20',
    },
    {
      id: 'resource',
      title: '大文件排查',
      desc: '磁盘空间预警、深层大文件安全清理',
      prompt: '系统磁盘空间告警，请帮我排查占用最大的前 5 大目录与大文件，并提供安全清理建议。',
      icon: HardDrive,
      color: 'text-sky-400',
      bgColor: 'bg-sky-500/10 hover:bg-sky-500/15 border-sky-500/20',
    },
    {
      id: 'ops',
      title: '端口与网络',
      desc: '端口监听冲突定位、进程优雅终止',
      prompt: '请帮我排查当前服务器正在监听的网络端口与对应进程，如果端口冲突如何优雅结束进程？',
      icon: Layers,
      color: 'text-amber-400',
      bgColor: 'bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/20',
    },
    {
      id: 'deploy',
      title: '容器与服务',
      desc: 'Docker 运行状态、崩溃重启与日志定位',
      prompt: '请帮我检查当前运行的 Docker 容器和核心 Systemd 服务状态，排查是否有异常退出或崩溃报错。',
      icon: Rocket,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/20',
    },
    {
      id: 'script',
      title: '脚本与调优',
      desc: 'Shell 自动化、日志轮转与性能基线',
      prompt: '请帮我写一个高效安全的 Linux 运维自动化 Shell 脚本（带错误检查、超时保护与日志自动轮转清理）。',
      icon: Terminal,
      color: 'text-violet-400',
      bgColor: 'bg-violet-500/10 hover:bg-violet-500/15 border-violet-500/20',
    },
  ]

  const RECOMMEND_PILLS = [
    { text: '诊断当前终端报错/输出', prompt: '请帮我分析当前活动终端里的最新报错信息与异常日志，给出排查解决办法。' },
    { text: '内存占用最高的是哪个应用？', prompt: '帮我排查当前服务器内存占用最高的是哪个应用，占用比例是多少？' },
    { text: '8080 端口被谁占用了？', prompt: '帮我查查 8080 端口当前被哪个进程监听或占用了？给出进程 PID 与处理方法。' },
    { text: '根分区快满了怎么安全清理？', prompt: '根分区磁盘空间利用率偏高，帮我查找大于 100MB 的日志或临时文件，并给出安全的清理命令。' },
    { text: '排查系统崩溃与 OOM-killer 记录', prompt: '帮我检查 dmesg 和内核日志中最近是否有 OOM-killer 杀死进程或系统严重报警记录？' },
    { text: 'Linux 生产环境安全基线加固', prompt: '请为这台 Linux 服务器提供一份基础安全加固方案（禁止 root 直连、SSH 密钥登录、开启防火墙）。' },
  ]

  // 隐藏态：小人只露一个头、斜着趴在窗口右边框上，点一下即可恢复
  if (isMascotMinimized && !isFloatingAssistantOpen && enableAiGlobal && showFloatingMascot) {
    return (
      <button
        type="button"
        data-testid="ai-mascot-peek"
        title={t('ai_mascot_peek_tip') || '点我恢复小助手'}
        onPointerDown={(e) => {
          if (e.button === 0) restoreFromPeek(e.clientX, e.clientY)
        }}
        onClick={(e) => restoreFromPeek(e.clientX, e.clientY)}
        className="group fixed right-0 z-40 flex -translate-y-1/2 translate-x-[60%] rotate-[-18deg] items-center justify-center transition-transform duration-200 hover:translate-x-[34%] cursor-pointer"
        style={{ width: 54, height: 54, top: mascotPeekY }}
      >
        <AIMascotAvatar
          size={46}
          mood={assistantMascotMood}
          isLight={isMascotLight}
          terminalAccentColor={terminalMascotAccent}
          showGlowRing={false}
          interactive={false}
          className="-translate-x-[14%] -translate-y-[10%]"
        />
      </button>
    )
  }

  // 必须在所有 React Hooks 执行完毕后才进行条件渲染判断，严格遵守 Rules of Hooks，避免开关切换时出现 "Rendered more hooks than during the previous render"
  if (!enableAiGlobal || (!showFloatingMascot && !isFloatingAssistantOpen)) {
    return null
  }

  const dialogLayout = getEffectiveDialogPosition()
  const mascotMenuPosition = mascotMenu
    ? clampMascotMenuPosition(mascotMenu.x, mascotMenu.y, MASCOT_MENU_WIDTH, MASCOT_MENU_RESERVE_HEIGHT)
    : null

  return (
    <>
      {/* 1. 全局悬浮机器人吉祥物按钮 (相对窗口右下角弹性锚定，缩放全屏不漂移) */}
      {showFloatingMascot && (
        <div
          data-testid="ai-mascot-trigger"
          title={`${t('ai_assistant_title') || '运维小助手'} (Ctrl+Alt+A)`}
          style={{
            position: 'fixed',
            right: `${mascotOffset.right}px`,
            bottom: `${mascotOffset.bottom}px`,
            zIndex: 40,
          }}
          onPointerDown={handleMascotPointerDown}
          onDoubleClick={handleMascotDoubleClick}
          onContextMenu={handleMascotContextMenu}
          className={cn(
            'select-none touch-none',
            isMascotDragging ? 'cursor-grabbing transition-none' : 'cursor-grab transition-transform duration-200',
            isFloatingAssistantOpen
              ? 'scale-90 opacity-40 hover:opacity-100'
              : 'scale-100 opacity-100 hover:scale-105 active:scale-95',
          )}
        >
          <div className="relative flex items-center justify-center">
            {/* 核心向外辐射的柔和环境霓虹微光晕 (纯向外扩散柔光，无硬边，让小人在深色或浅色背景上极度醒目耀眼) */}
            <div
              className={cn(
                'absolute -inset-3 rounded-full pointer-events-none transition-all duration-300',
                isMascotLight
                  ? 'bg-sky-400/25 blur-lg'
                  : 'bg-radial from-cyan-400/40 via-sky-500/20 to-transparent blur-xl animate-pulse'
              )}
            />

            {/* 纯净悬浮 Q-Bitz 吉祥物主体，带双重轮廓发光 */}
            <AIMascotAvatar
              size={MASCOT_SIZE}
              mood={assistantMascotMood}
              isLight={isMascotLight}
              terminalAccentColor={terminalMascotAccent}
              showGlowRing={false}
              interactive={!isMascotDragging}
              className={cn(
                'relative filter transition-all duration-300',
                isMascotLight
                  ? 'drop-shadow-[0_0_12px_rgba(14,165,233,0.45)] drop-shadow-[0_6px_16px_rgba(0,0,0,0.18)]'
                  : 'drop-shadow-[0_0_12px_rgba(56,189,248,0.75)] drop-shadow-[0_0_28px_rgba(14,165,233,0.45)] drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]'
              )}
            />
          </div>
        </div>
      )}

      {/* 小人右键菜单：打开/关闭小助手 / 配置 / 重置位置 / 关闭 AI 总开关 */}
      {mascotMenu && mascotMenuPosition && (
        <div
          data-testid="ai-mascot-menu"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: mascotMenuPosition.left,
            top: mascotMenuPosition.top,
            bottom: mascotMenuPosition.bottom,
            zIndex: 70,
          }}
          className="w-[196px] rounded-lg border border-border/60 bg-background/98 p-1 text-xs text-foreground shadow-xl backdrop-blur-xl select-none"
        >
          <button
            type="button"
            data-testid="ai-mascot-menu-toggle-assistant"
            onClick={handleMascotMenuToggleAssistant}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted cursor-pointer"
          >
            {isFloatingAssistantOpen ? (
              <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
            )}
            <span>
              {isFloatingAssistantOpen
                ? t('ai_mascot_menu_close') || '关闭小助手'
                : t('ai_mascot_menu_open') || '打开小助手'}
            </span>
          </button>
          <button
            type="button"
            data-testid="ai-mascot-menu-config"
            onClick={handleMascotMenuConfig}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted cursor-pointer"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t('ai_mascot_menu_config') || '配置'}</span>
          </button>
          <button
            type="button"
            data-testid="ai-mascot-menu-reset"
            onClick={handleMascotMenuReset}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t('ai_mascot_menu_reset') || '重置位置'}</span>
          </button>
          <div className="my-1 h-px bg-border/50" />
          <button
            type="button"
            data-testid="ai-mascot-menu-disable-ai"
            title={t('ai_mascot_menu_disable_ai_tip') || '关闭后悬浮小人与所有 AI 入口将隐藏，可在 设置 → AI 中重新开启'}
            onClick={handleMascotMenuDisableAi}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10 cursor-pointer"
          >
            <PowerOff className="h-3.5 w-3.5 shrink-0" />
            <span>{t('ai_mascot_menu_disable_ai') || '关闭 AI 总开关'}</span>
          </button>
        </div>
      )}

      {/* 2. 点击弹出的 AI 助手窗口面板 (支持任意拖拽，比例舒适宽屏) */}
      {isFloatingAssistantOpen && (
        <div
          data-testid="ai-assistant-dialog"
          role="dialog"
          aria-modal="false"
          tabIndex={-1}
          style={{
            position: 'fixed',
            left: `${dialogLayout.x}px`,
            top: `${dialogLayout.y}px`,
            width: `${dialogLayout.width}px`,
            height: `${dialogLayout.height}px`,
            zIndex: 50,
          }}
          onContextMenu={handleContextMenu}
          onMouseDown={handleDialogMouseDown}
          onMouseUp={handleDialogMouseUp}
          onKeyDown={(e) => {
            // 当用户在 AI 助手窗口内按 Ctrl+C / Cmd+C 时：
            // 阻止冒泡到终端层（防止终端拦截触发 SIGINT 中断终止），
            // 并确保将选中文本正确复制到系统剪贴板。
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
              e.stopPropagation()
              const sel = window.getSelection()?.toString()?.trim()
              if (sel) {
                try {
                  navigator.clipboard.writeText(sel)
                  playSound(SoundType.Click)
                  toast.success(t('ai_ctx_copied') || '已复制到剪贴板')

                  // 若快捷弹框尚未展示，直接根据选区位置唤起弹框兜底
                  if (!contextMenu) {
                    const selection = window.getSelection()
                    if (selection && selection.rangeCount > 0) {
                      const range = selection.getRangeAt(0)
                      const rect = range.getBoundingClientRect()
                      const target = e.target as HTMLElement | null
                      const isCode = Boolean(target?.closest('pre, code'))
                      setContextMenu({
                        x: rect.right,
                        y: rect.bottom,
                        text: sel,
                        isCode,
                        hasSelection: true,
                      })
                    }
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          }}
          className={cn(
            "relative flex flex-col overflow-hidden rounded-2xl select-text animate-in fade-in zoom-in-95 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-gradient-to-r before:from-transparent before:via-primary/70 before:to-transparent before:content-['']",
            themeStyles.dialogContainer,
            isDialogDragging || isDialogResizing ? 'transition-none select-none shadow-cyan-500/10' : 'transition-all duration-150',
          )}
        >
          {/* Header 顶部拖拽栏 */}
          <div
            onPointerDown={handleDialogHeaderPointerDown}
            className={cn(
              'flex items-center justify-between px-4 py-2.5 select-none shrink-0 cursor-move transition-colors',
              themeStyles.header,
            )}
          >
            {/* 左侧：小人微标 + 标题 + 状态徽章 */}
            <div className="flex items-center gap-2">
              <AIMascotAvatar size={22} mood={assistantMascotMood} isLight={isMascotLight} terminalAccentColor={terminalMascotAccent} showGlowRing={false} interactive={false} />
              <span className="text-[13px] font-semibold tracking-tight text-inherit">
                {t('ai_assistant_title') || '运维小助手'}
              </span>
              <span className={cn('hidden sm:inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px]', themeStyles.copilotBadge)}>
                <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                AIOps Copilot
              </span>
              <div className="hidden sm:flex items-center opacity-25 ml-0.5">
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* 右侧：功能控制按钮 (阻止向上传递拖拽) */}
            <div
              className="flex items-center gap-1 opacity-80"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* 新建对话按钮 (+) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="ai-new-session-btn"
                    onClick={() => {
                      createNewAssistantSession()
                      setShowHistoryPanel(false)
                      playSound(SoundType.Click)
                      setTimeout(() => textareaRef.current?.focus(), 50)
                    }}
                    className={cn('h-7 w-7 rounded-lg cursor-pointer transition-colors', themeStyles.headerBtn)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('ai_new_chat') || '新建对话'}
                </TooltipContent>
              </Tooltip>

              {/* 历史记录按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="ai-history-toggle-btn"
                    onClick={() => {
                      setShowHistoryPanel((prev) => !prev)
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'h-7 w-7 rounded-lg cursor-pointer transition-colors',
                      themeStyles.headerBtn,
                      showHistoryPanel && 'bg-primary/15 text-primary font-medium hover:bg-primary/20',
                    )}
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {t('ai_history_title') || '会话记录'}
                </TooltipContent>
              </Tooltip>

              {/* 关闭/最小化按钮 (退出时重置卡片位置) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="ai-dialog-close-btn"
                    onClick={handleExitAssistant}
                    className={cn('h-7 w-7 rounded-lg cursor-pointer transition-colors', themeStyles.headerBtn)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs flex items-center gap-1.5">
                  <span>关闭</span>
                  <Kbd size="xs">Esc</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* 会话历史抽屉覆盖层 */}
          {showHistoryPanel && (
            <div
              data-testid="ai-history-panel"
              className={cn(
                'absolute inset-x-0 top-[49px] bottom-0 z-30 flex flex-col animate-in fade-in slide-in-from-right-4 duration-150 select-none',
                themeStyles.historyPanel,
              )}
            >
              {/* 抽屉头部 */}
              <div className={cn('flex items-center justify-between px-4 py-2.5 border-b shrink-0', themeStyles.header)}>
                <div className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5 text-primary" />
                  <span className={cn('text-xs font-semibold', themeStyles.welcomeTitle)}>
                    {t('ai_history_title') || '会话记录'}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-mono"
                    title={`最多保留 ${settings.maxAssistantSessions || 30} 场会话，超出自动滚动淘汰旧会话`}
                  >
                    {assistantSessions.length} / {settings.maxAssistantSessions || 30}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {assistantSessions.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="ai-clear-all-sessions-btn"
                      onClick={() => {
                        if (
                          window.confirm(
                            t('ai_clear_history_confirm') || '确定要清空全部 AI 会话历史记录吗？',
                          )
                        ) {
                          clearAllAssistantSessions()
                          setShowHistoryPanel(false)
                          playSound(SoundType.Click)
                        }
                      }}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 rounded-md cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{t('ai_clear_history') || '清空'}</span>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowHistoryPanel(false)}
                    className="h-6 w-6 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* 会话列表 */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
                {assistantSessions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-6 text-center text-muted-foreground select-none">
                    <div className="h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center mb-2.5 text-muted-foreground/60">
                      <Clock className="h-5 w-5" />
                    </div>
                    <p className={cn('text-xs font-medium mb-1', themeStyles.welcomeTitle)}>
                      {t('ai_no_history') || '暂无历史会话'}
                    </p>
                    <p className={cn('text-[11px] max-w-[220px] leading-relaxed', themeStyles.welcomeSub)}>
                      {t('ai_no_history_desc') || '开启一段对话后，将自动在此记录提问历史'}
                    </p>
                  </div>
                ) : (
                  assistantSessions.map((session) => {
                    const isActive = session.id === currentAssistantSessionId
                    return (
                      <div
                        key={session.id}
                        data-testid={`session-item-${session.id}`}
                        onClick={() => {
                          loadAssistantSession(session.id)
                          setShowHistoryPanel(false)
                          playSound(SoundType.Click)
                          setTimeout(() => textareaRef.current?.focus(), 50)
                        }}
                        className={cn(
                          'group relative flex items-start justify-between gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                          isActive
                            ? 'bg-primary/8 border-primary/40 shadow-2xs ring-1 ring-primary/20'
                            : 'bg-card/70 hover:bg-muted/50 border-border/50 hover:border-border',
                        )}
                      >
                        <div className="flex-1 min-w-0 pr-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            {isActive && (
                              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                            <span
                              className={cn(
                                'text-xs truncate block',
                                isActive
                                  ? 'text-primary font-semibold'
                                  : cn('font-medium', themeStyles.welcomeTitle),
                              )}
                            >
                              {session.title || '新会话'}
                            </span>
                          </div>
                          <div className={cn('flex items-center gap-2 text-[10.5px]', themeStyles.welcomeSub)}>
                            <span className="font-mono opacity-80">
                              {formatSessionTime(session.updatedAt || session.createdAt)}
                            </span>
                            <span>·</span>
                            <span>{session.messages.length} 条对话</span>
                            {session.mode === 'chat' ? (
                              <span className="text-[9.5px] px-1 py-0.2 rounded bg-muted text-muted-foreground">
                                问答
                              </span>
                            ) : (
                              <span className="text-[9.5px] px-1 py-0.2 rounded bg-primary/10 text-primary">
                                Agent
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 单条删除 */}
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid={`delete-session-${session.id}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteAssistantSession(session.id)
                            if (assistantSessions.length <= 1) {
                              setShowHistoryPanel(false)
                            }
                            playSound(SoundType.Click)
                          }}
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0 transition-opacity cursor-pointer"
                          title={t('ai_delete_session') || '删除会话'}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )
                  })
                )}
              </div>

              {/* 抽屉底部快捷按钮 */}
              <div className="p-3 border-t border-border/60 bg-muted/15 shrink-0 select-none">
                <Button
                  onClick={() => {
                    createNewAssistantSession()
                    setShowHistoryPanel(false)
                    playSound(SoundType.Click)
                    setTimeout(() => textareaRef.current?.focus(), 50)
                  }}
                  className="w-full h-8 text-xs font-medium gap-1.5 rounded-lg cursor-pointer shadow-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('ai_new_chat') || '新建对话'}</span>
                </Button>
              </div>
            </div>
          )}

          {/* 未配置 AI 提示引导横幅 (方案 B) */}
          {!isAiConfigured && (
            <div className="mx-4 mt-3 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2 shadow-2xs select-none shrink-0 animate-in fade-in slide-in-from-top-1">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="text-[11.5px] leading-tight truncate">
                  {t('ai_offline_mode_banner')}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  playSound(SoundType.Click)
                  window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai' }))
                }}
                className="h-6 px-2 text-[11px] font-semibold border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200 gap-1 shrink-0 cursor-pointer shadow-none"
              >
                <span>{t('ai_go_to_config')}</span>
                <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Body 消息与空状态区域 */}
          <div
            ref={messagesContainerRef}
            onScroll={handleChatScroll}
            data-testid="ai-chat-scroll-container"
            className="flex-1 overflow-y-auto px-4 py-3.5 space-y-5 select-text relative"
          >
            {assistantMessages.length === 0 ? (
              /* 空状态：轻量欢迎区 + 紧凑能力入口 + 推荐提问 */
              <div className="flex flex-col gap-5 py-2">
                <div className="flex flex-col items-center gap-2 pt-2 pb-1 text-center">
                  <AIMascotAvatar size={40} mood={assistantMascotMood} isLight={isMascotLight} terminalAccentColor={terminalMascotAccent} showGlowRing={false} />
                  <div className="space-y-1">
                    <p className={cn('text-[11px]', themeStyles.welcomeSub)}>
                      您好，欢迎使用
                    </p>
                    <h1 className={cn('text-[17px] font-semibold tracking-tight', themeStyles.welcomeTitle)}>
                      {t('ai_assistant_title') || '运维小助手'}
                    </h1>
                    <p className={cn('text-[11px] leading-relaxed', themeStyles.welcomeSub)}>
                      直接提问即可，我会用已保存的凭据连接主机实地排查
                    </p>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between px-0.5">
                    <span className={cn('text-[11px] font-semibold', themeStyles.welcomeSub)}>
                      我可以帮您
                    </span>
                    <span className="text-[10px] text-muted-foreground/55">点击卡片直接发起</span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
                    {CAPABILITY_CARDS.map((card) => {
                      const IconComponent = card.icon
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => {
                            playSound(SoundType.Click)
                            void sendAssistantMessage(card.prompt)
                          }}
                          className="group flex flex-col items-start gap-1.5 rounded-xl border border-border/40 bg-muted/20 p-2.5 text-left cursor-pointer transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
                        >
                          <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-lg', themeStyles.iconBox)}>
                            <IconComponent className="h-3.5 w-3.5" />
                          </span>
                          <span className={cn('text-[11.5px] font-semibold leading-tight', themeStyles.cardTitle)}>
                            {card.title}
                          </span>
                          <span className={cn('line-clamp-2 text-[10px] leading-snug', themeStyles.cardDesc)}>
                            {card.desc}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <div className={cn('mb-2 px-0.5 text-[11px] font-semibold', themeStyles.welcomeSub)}>
                    试试这样问
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {RECOMMEND_PILLS.map((pill, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          playSound(SoundType.Click)
                          void sendAssistantMessage(pill.prompt)
                        }}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] cursor-pointer transition-colors',
                          themeStyles.recommendPill,
                        )}
                      >
                        <Sparkles className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        <span className={themeStyles.pillText}>{pill.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* 会话流视图：支持富文本排版、代码块语法高亮与"填入终端" */
              <div className="space-y-4">
                {assistantMessages.map((msg) => {
                  const isUser = msg.role === 'user'
                  const parsedAi = !isUser ? parseThinkingAndContent(msg.content) : null
                  const hasAgentAction = Boolean(
                    msg.executionCard ||
                    (msg.suggestedCommands && msg.suggestedCommands.length > 0) ||
                    (parsedAi && parsedAi.agentDecisions && parsedAi.agentDecisions.length > 0),
                  )

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        'group relative flex gap-2 items-start',
                        isUser ? 'flex-row-reverse justify-start' : 'justify-start',
                      )}
                    >
                      {/* 头像 */}
                      {!isUser ? (
                        <div className="shrink-0 mt-0.5">
                          <AIMascotAvatar
                            size={28}
                            mood={msg.status === 'error' ? 'blink' : 'idle'}
                            isLight={isMascotLight}
                            terminalAccentColor={terminalMascotAccent}
                            showGlowRing={false}
                            interactive={false}
                          />
                        </div>
                      ) : (
                        <div className={cn('h-7 w-7 rounded-full flex items-center justify-center text-[11px] shrink-0 mt-0.5', themeStyles.userAvatar)}>
                          我
                        </div>
                      )}

                      {/* 消息主体容器 (垂直排列气泡与下方操作栏) */}
                      <div className={cn('flex flex-col max-w-[85%]', isUser ? 'items-end' : 'items-start')}>
                        {/* 气泡正文 */}
                        <div
                          data-message-content="true"
                          className={cn(
                            'rounded-2xl text-xs leading-relaxed',
                            isUser
                              ? cn('px-3.5 py-2.5 rounded-tr-sm', themeStyles.userBubble)
                              : cn('w-full rounded-tl-sm px-0.5 py-1 space-y-2', themeStyles.aiBubble),
                          )}
                        >
                          {/* 模式标签：弱化为一行说明，不抢占正文视觉 */}
                          {!isUser && msg.mode && (
                            <div
                              data-testid="ai-bubble-badge"
                              className={cn('flex items-center gap-1.5 mb-1.5 text-[10px] font-medium opacity-70', themeStyles.aiBubbleHeader)}
                            >
                              {msg.mode === 'agent' ? (
                                hasAgentAction ? (
                                  <>
                                    <Sparkles className="h-3 w-3 text-primary" />
                                    <span>{t('ai_badge_agent_execution') || 'Agent 运维执行'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Bot className="h-3 w-3 text-primary" />
                                    <span>{t('ai_badge_agent_qa') || 'AIOps 智能解答'}</span>
                                  </>
                                )
                              ) : (
                                <>
                                  <MessageSquare className="h-3 w-3 text-primary" />
                                  <span>{t('ai_badge_chat_qa') || 'Chat 咨询解答'}</span>
                                </>
                              )}
                            </div>
                          )}

                          {/* 文本内容与交互式代码块 */}
                          {isUser ? (
                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                          ) : (
                            <>
                              <AssistantMessageRenderer
                                content={msg.content}
                                onCopy={handleCopyCommand}
                                copiedCode={copiedCode}
                                isStreaming={msg.status === 'streaming'}
                                themeStyles={themeStyles}
                              />
                              {msg.status === 'streaming' && (
                                <span
                                  data-testid="streaming-cursor"
                                  className="inline-block w-1.5 h-3.5 bg-primary align-middle animate-pulse ml-0.5 rounded-2xs"
                                />
                              )}
                              {msg.executionCard && (
                                <CommandExecutionCard
                                  card={msg.executionCard}
                                  messageId={msg.id}
                                  onCopy={handleCopyCommand}
                                  copiedCode={copiedCode}
                                  onExecute={executeMessageCommand}
                                  onReject={rejectMessageCommand}
                                />
                              )}
                              {msg.pipelineExplain && (
                                <PipelineBlocksViewer
                                  data={msg.pipelineExplain}
                                  onCopyToTerminal={(cmd) => {
                                    window.dispatchEvent(
                                      new CustomEvent('insert-terminal-command', {
                                        detail: { command: cmd, execute: false },
                                      }),
                                    )
                                  }}
                                />
                              )}
                              {!isUser && isServerPickerNeeded(msg.content) && (
                                <UnattachedServerPicker
                                  userPrompt={
                                    assistantMessages
                                      .slice(0, assistantMessages.findIndex((m) => m.id === msg.id))
                                      .reverse()
                                      .find((m) => m.role === 'user')?.content
                                  }
                                  onSelectSingle={(server, originalPrompt) => {
                                    playSound(SoundType.Click)
                                    const query = originalPrompt
                                      ? `针对【${server.name || server.host}】(${server.host}) 服务器：${originalPrompt}`
                                      : `请帮我全面体检【${server.name || server.host}】服务器 (${server.host})`
                                    void sendAssistantMessage(query)
                                  }}
                                  onSelectBatch={(servers, originalPrompt) => {
                                    playSound(SoundType.Click)
                                    const listStr = servers
                                      .map((s) => `【${s.name || s.host}】(${s.host})`)
                                      .join('、')
                                    const query = originalPrompt
                                      ? `针对以下服务器批量执行排查（${listStr}）：${originalPrompt}`
                                      : `请帮我巡检以下服务器：${listStr}`
                                    void sendAssistantMessage(query)
                                  }}
                                  onInspectAll={(originalPrompt) => {
                                    playSound(SoundType.Click)
                                    const query = originalPrompt
                                      ? `帮我全面巡检已纳管的所有服务器，重点排查：${originalPrompt}`
                                      : '帮我全面巡检已纳管的所有服务器，排查是否有高负载、磁盘爆满或异常节点。'
                                    void sendAssistantMessage(query)
                                  }}
                                />
                              )}
                            </>
                          )}
                        </div>

                        {/* 底部操作栏：一键复制 (常驻低对比，hover 高亮) */}
                        <div
                          className={cn(
                            'flex items-center pt-1.5 text-muted-foreground opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity',
                            isUser ? 'justify-end pr-1' : 'justify-start pl-1',
                          )}
                        >
                          <button
                            type="button"
                            data-testid={isUser ? `copy-user-msg-${msg.id}` : `copy-ai-msg-${msg.id}`}
                            onClick={() => handleCopyMessage(msg.id, msg.content)}
                            className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] transition-all cursor-pointer', themeStyles.copyActionBtn)}
                            title={isUser ? '复制提问' : '复制全文'}
                          >
                            {copiedMessageId === msg.id ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-500" />
                                <span className="text-emerald-500 font-medium">已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* 思考中/首字前推导等待状态 */}
                {isAssistantResponding &&
                  !assistantMessages.some(
                    (m) => m.role === 'assistant' && m.status === 'streaming' && m.content.length > 0,
                  ) && (
                    <div className="flex gap-2.5 items-start">
                      <div className="shrink-0 mt-0.5">
                        <AIMascotAvatar size={28} mood="thinking" isLight={isMascotLight} terminalAccentColor={terminalMascotAccent} showGlowRing={false} interactive={false} />
                      </div>
                      <div className="rounded-xl border border-border/40 bg-muted/25 px-3 py-2 text-xs flex items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <div className="flex space-x-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce delay-100" />
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce delay-200" />
                          </div>
                          <span>AI 助手正在深度推导中...</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid="ai-stop-thinking-btn"
                          onClick={() => {
                            stopAssistantResponding()
                            playSound(SoundType.Click)
                          }}
                          className="h-5 px-1.5 text-[10.5px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded gap-1 cursor-pointer transition-colors"
                          title={t('ai_stop_generating') || '停止生成'}
                        >
                          <CircleStop className="h-3 w-3" />
                          <span>{t('ai_stop_generating') || '停止'}</span>
                        </Button>
                      </div>
                    </div>
                  )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* 向上滑动脱离底部追踪时，显示直观的“追踪最新输出”浮动胶囊 */}
          {showScrollBottomBtn && (
            <div className="absolute bottom-[84px] right-6 z-20 pointer-events-auto animate-in fade-in zoom-in-95 duration-150">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="ai-scroll-to-bottom-btn"
                onClick={scrollToBottom}
                className="h-7 px-2.5 text-[11px] font-medium bg-background/95 text-foreground border border-border/60 shadow-sm hover:bg-muted backdrop-blur-xs gap-1.5 rounded-full cursor-pointer transition-all"
              >
                <ArrowDown className="w-3 h-3 text-primary animate-bounce" />
                <span>{isAssistantResponding ? '追踪最新输出' : '回到底部'}</span>
              </Button>
            </div>
          )}

          {/* 危险模式：显著视觉警示 + 一键退出（不展示倒计时） */}
          {dangerModeActive && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-t border-destructive/30 bg-destructive/10 text-[11px] text-destructive">
              <span className="flex items-center gap-1.5 min-w-0 truncate">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                {t('ai_danger_mode_banner') || '危险模式已开启 · 写命令将自动执行'}
              </span>
              <button
                type="button"
                onClick={deactivateDangerMode}
                className="shrink-0 font-medium underline underline-offset-2 cursor-pointer"
              >
                {t('ai_danger_mode_disable') || '立即关闭'}
              </button>
            </div>
          )}

          {/* Bottom 输入区域：单一输入卡 + 内嵌工具栏 */}
          <div className={cn('px-3 pt-2 pb-1.5 shrink-0 space-y-1 transition-colors', themeStyles.inputBar)}>
            <div className={cn('relative rounded-xl transition-all p-2.5 flex flex-col justify-between min-h-[68px] gap-1', themeStyles.inputCard)}>
              {/* 智能指令拆解意图提示胶囊 */}
              {detectedInputIntent?.intent === 'explain_shell' && (
                <div
                  data-testid="detected-explain-pill"
                  className="flex items-center gap-1.5 px-2 py-1 mb-0.5 rounded-lg bg-primary/10 border border-primary/20 text-[10.5px] text-primary select-none animate-in fade-in slide-in-from-bottom-1"
                >
                  <Layers className="h-3 w-3 shrink-0 animate-pulse" />
                  <span className="truncate font-medium">
                    🧩 检测到复合指令/管道，回车将自动触发乐高积木式拆解
                  </span>
                </div>
              )}
              {/* Textarea 多行自适应输入 */}
              <textarea
                ref={textareaRef}
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                onKeyDown={handleKeyDownInInput}
                placeholder="你可以输入任何运维排障、命令生成或脚本问题..."
                rows={1}
                className="w-full bg-transparent resize-none outline-none text-[12.5px] text-inherit placeholder:opacity-60 leading-relaxed min-h-[32px] max-h-[100px] px-1 pt-0.5"
              />

              {/* 输入框底部动作条：左侧 Agent/Chat 切换，右侧停止/发送按钮 */}
              <div className="flex items-center justify-between pt-0.5">
                <div className={cn('flex items-center p-0.5 rounded-lg border text-[11px] transition-colors', themeStyles.modePillContainer)}>
                  <button
                    type="button"
                    onClick={() => {
                      setAssistantMode('agent')
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium leading-none transition-all cursor-pointer',
                      assistantMode === 'agent'
                        ? themeStyles.modeBtnActive
                        : themeStyles.modeBtnInactive,
                    )}
                  >
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>Agent</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAssistantMode('chat')
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-medium leading-none transition-all cursor-pointer',
                      assistantMode === 'chat'
                        ? themeStyles.modeBtnActive
                        : themeStyles.modeBtnInactive,
                    )}
                  >
                    <MessageSquare className="h-3 w-3 opacity-70" />
                    <span>Chat</span>
                  </button>
                </div>

                {/* 发送 / 停止生成按钮 */}
                {isAssistantResponding ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-testid="ai-stop-responding-btn"
                        onClick={() => {
                          stopAssistantResponding()
                          playSound(SoundType.Click)
                        }}
                        className="h-7 w-7 rounded-lg border border-border/60 hover:border-destructive/60 bg-background hover:bg-destructive/10 text-muted-foreground hover:text-destructive flex items-center justify-center cursor-pointer transition-all"
                        title={t('ai_stop_generating') || '停止生成'}
                      >
                        <CircleStop className="h-3.5 w-3.5 transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      {t('ai_stop_generating') || '停止生成'}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <button
                    type="button"
                    data-testid="ai-send-btn"
                    disabled={!assistantInput.trim()}
                    onClick={handleSend}
                    className={cn(
                      'h-7 w-7 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer',
                      assistantInput.trim()
                        ? themeStyles.sendBtnActive
                        : themeStyles.sendBtnDisabled,
                    )}
                    title={t('ai_send_message') || '发送 (Enter)'}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 底部免责声明：单行极简，不再占用独立条带高度 */}
            <div className={cn('text-[9px] leading-none text-center select-none truncate px-1', themeStyles.disclaimerText)}>
              内容由 AI 生成，仅供参考 · Enter 发送 · Shift+Enter 换行
            </div>
          </div>

          {/* 8 方向边缘与角落拉伸热区 (支持自由拖拽调整宽高，上下受限) */}
          {/* 四边 */}
          <div
            data-testid="ai-resize-n"
            className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-20"
            onPointerDown={(e) => handleResizePointerDown('n', e)}
          />
          <div
            data-testid="ai-resize-s"
            className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-20"
            onPointerDown={(e) => handleResizePointerDown('s', e)}
          />
          <div
            data-testid="ai-resize-w"
            className="absolute top-3 bottom-3 left-0 w-2 cursor-ew-resize z-20"
            onPointerDown={(e) => handleResizePointerDown('w', e)}
          />
          <div
            data-testid="ai-resize-e"
            className="absolute top-3 bottom-3 right-0 w-2 cursor-ew-resize z-20"
            onPointerDown={(e) => handleResizePointerDown('e', e)}
          />

          {/* 四角 */}
          <div
            data-testid="ai-resize-nw"
            className="absolute top-0 left-0 w-3.5 h-3.5 cursor-nwse-resize z-30"
            onPointerDown={(e) => handleResizePointerDown('nw', e)}
          />
          <div
            data-testid="ai-resize-ne"
            className="absolute top-0 right-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
            onPointerDown={(e) => handleResizePointerDown('ne', e)}
          />
          <div
            data-testid="ai-resize-sw"
            className="absolute bottom-0 left-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
            onPointerDown={(e) => handleResizePointerDown('sw', e)}
          />
          <div
            data-testid="ai-resize-se"
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30 flex items-end justify-end p-0.5 group/grip cursor-pointer"
            onPointerDown={(e) => handleResizePointerDown('se', e)}
            title="拖拽调整大小"
          >
            {/* 右下角精致拉伸把手微标 */}
            <svg
              viewBox="0 0 10 10"
              className="w-2.5 h-2.5 text-muted-foreground/30 group-hover/grip:text-primary transition-colors pointer-events-none"
              fill="currentColor"
            >
              <path d="M8 2 L2 8 M8 5 L5 8 M8 8 L8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      )}

      {/* 3. AI 助手划选与快捷交互右键上下文菜单 */}
      {isFloatingAssistantOpen && contextMenu && (
        <AIAssistantContextMenu
          ctxMenu={contextMenu}
          isLightTerminal={isLightTerminal}
          isInTerminal={isInTerminal}
          onClose={() => setContextMenu(null)}
          onCopy={handleCopyFromContextMenu}
          onExecuteInTerminal={handleExecuteInTerminal}
          onInsertToTerminal={handleInsertToTerminal}
        />
      )}
    </>
  )
}
