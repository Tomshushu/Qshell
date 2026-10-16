/**
 * src/components/ai/floating-ai-assistant.tsx
 *
 * Qshell 全局悬浮 AI 助手组件 (Floating AI Assistant & Copilot Mascot)
 * 1. 悬浮吉祥物小人：相对窗口右下角弹性锚定（窗口缩放/全屏时绝不漂移），支持全屏自由拖拽与持久化记忆
 * 2. 对话弹出面板：支持通过顶部标题栏任意拖拽移动、宽高自适应平衡（告别瘦高条）、支持宽屏全景模式
 * 3. 富文本与命令互通：内置 Markdown 语法解析与交互式代码块，支持一键填入终端并执行
 */

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useAIStore } from '@/store/ai-store'
import { AIMascotAvatar } from './ai-mascot-avatar'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import { marked } from 'marked'
import {
  Sparkles,
  MessageSquare,
  ArrowUp,
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
  BarChart3,
  Rocket,
  HardDrive,
  Lightbulb,
  GripHorizontal,
  AlertCircle,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { hasActiveAIProvider } from '@/store/ai-store'

const MASCOT_SIZE = 44
const STORAGE_MASCOT_OFFSET_KEY = 'qshell_ai_mascot_offset_v3'

interface MascotOffset {
  right: number
  bottom: number
}

function loadSavedMascotOffset(): MascotOffset {
  try {
    const raw = localStorage.getItem(STORAGE_MASCOT_OFFSET_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
        return parsed
      }
    }
  } catch {
    /* ignore */
  }
  return { right: 28, bottom: 48 }
}

function saveMascotOffset(offset: MascotOffset) {
  try {
    localStorage.setItem(STORAGE_MASCOT_OFFSET_KEY, JSON.stringify(offset))
  } catch {
    /* ignore */
  }
}

/**
 * 助手消息 Markdown 与代码块分段渲染组件
 */
function AssistantMessageRenderer({
  content,
  onCopy,
  onInsert,
  copiedCode,
  insertedCode,
}: {
  content: string
  onCopy: (code: string) => void
  onInsert: (code: string) => void
  copiedCode: string | null
  insertedCode: string | null
}) {
  const parts = useMemo(() => {
    const result: Array<{ type: 'markdown' | 'code'; text: string; lang?: string }> = []
    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: 'markdown',
          text: content.slice(lastIndex, match.index),
        })
      }
      result.push({
        type: 'code',
        lang: match[1]?.trim() || 'bash',
        text: match[2].trim(),
      })
      lastIndex = match.index + match[0].length
    }

    if (lastIndex < content.length) {
      result.push({
        type: 'markdown',
        text: content.slice(lastIndex),
      })
    }
    return result
  }, [content])

  return (
    <div className="space-y-2 text-xs leading-relaxed">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          const isCopied = copiedCode === part.text
          const isInserted = insertedCode === part.text

          return (
            <div
              key={idx}
              className="my-2 rounded-xl border border-border/70 bg-zinc-950/80 dark:bg-black/60 overflow-hidden shadow-xs"
            >
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40 text-[10px] text-muted-foreground select-none">
                <div className="flex items-center gap-1.5 font-mono font-medium">
                  <Terminal className="h-3 w-3 text-primary" />
                  <span>{part.lang}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onCopy(part.text)}
                    className="h-5 px-1.5 text-[10px] gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {isCopied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{isCopied ? '已复制' : '复制'}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onInsert(part.text)}
                    className="h-5 px-2 text-[10px] gap-1 font-medium border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground cursor-pointer"
                  >
                    <Terminal className="h-3 w-3" />
                    <span>{isInserted ? '已填入' : '填入终端'}</span>
                  </Button>
                </div>
              </div>
              <pre className="p-3 text-[11px] font-mono text-zinc-100 overflow-x-auto leading-relaxed select-text">
                <code>{part.text}</code>
              </pre>
            </div>
          )
        }

        const html = marked.parse(part.text, { gfm: true, breaks: true }) as string
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
    assistantInput,
    setAssistantInput,
    assistantMascotMood,
    sendAssistantMessage,
    clearAssistantMessages,
    configuredProviders,
    settings,
  } = useAIStore()

  const isAiConfigured = useMemo(
    () => hasActiveAIProvider(configuredProviders, settings),
    [configuredProviders, settings],
  )

  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [insertedCode, setInsertedCode] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
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

  // 窗口 resize 时安全校验
  useEffect(() => {
    const handleResize = () => {
      setMascotOffset((prev) => ({
        right: Math.min(Math.max(12, prev.right), Math.max(12, window.innerWidth - MASCOT_SIZE - 12)),
        bottom: Math.min(Math.max(12, prev.bottom), Math.max(12, window.innerHeight - MASCOT_SIZE - 12)),
      }))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 快捷键支持：Ctrl+Alt+A / Cmd+Alt+A 切换 AI 助手
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enableAiGlobal) return
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        if (isFloatingAssistantOpen) {
          playSound(SoundType.Close)
          closeFloatingAssistant()
        } else {
          playSound(SoundType.Open)
          openFloatingAssistant()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enableAiGlobal, isFloatingAssistantOpen, openFloatingAssistant, closeFloatingAssistant])

  // 自动滚动到最新消息
  useEffect(() => {
    if (isFloatingAssistantOpen && assistantMessages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [assistantMessages, isFloatingAssistantOpen])

  // 弹窗打开时聚焦输入框
  useEffect(() => {
    if (isFloatingAssistantOpen) {
      setTimeout(() => textareaRef.current?.focus(), 150)
    }
  }, [isFloatingAssistantOpen])

  if (!enableAiGlobal) {
    return null
  }

  if (!showFloatingMascot && !isFloatingAssistantOpen) {
    return null
  }

  const handleToggle = () => {
    if (isFloatingAssistantOpen) {
      playSound(SoundType.Close)
      closeFloatingAssistant()
    } else {
      playSound(SoundType.Open)
      openFloatingAssistant()
    }
  }

  // 鼠标拖拽小人事件（按右/底相对偏移拖动）
  const handleMascotPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

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

      if (!mascotDragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
        mascotDragRef.current.hasMoved = true
        setIsMascotDragging(true)
      }

      if (mascotDragRef.current.hasMoved) {
        // 向右拖动减小 right 偏移，向左拖动增大 right 偏移
        const nextRight = Math.min(
          Math.max(12, mascotDragRef.current.startRight - dx),
          Math.max(12, window.innerWidth - MASCOT_SIZE - 12),
        )
        // 向下拖动减小 bottom 偏移，向上拖动增大 bottom 偏移
        const nextBottom = Math.min(
          Math.max(12, mascotDragRef.current.startBottom - dy),
          Math.max(12, window.innerHeight - MASCOT_SIZE - 12),
        )
        setMascotOffset({ right: nextRight, bottom: nextBottom })
      }
    }

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)

      if (mascotDragRef.current.hasMoved) {
        setIsMascotDragging(false)
        setMascotOffset((latest) => {
          saveMascotOffset(latest)
          return latest
        })
      } else {
        handleToggle()
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 计算弹窗当前尺寸 (支持最大化 占右侧 1/3，严格保持 420:600 比例不变)
  const getDialogDimensions = () => {
    if (typeof window === 'undefined') {
      return { width: 420, height: 600 }
    }

    if (isMaximized) {
      const maxAllowedHeight = window.innerHeight - 32
      // 占屏幕右侧 1/3 宽度 (下限保底 420px，不超过屏幕可用宽度 - 32)
      const targetWidth = Math.max(420, Math.min(Math.floor(window.innerWidth / 3), window.innerWidth - 32))
      // 严格保持原始 420:600 (即 7:10) 纵横比不变
      let calculatedHeight = Math.round(targetWidth * (600 / 420))
      let calculatedWidth = targetWidth

      if (calculatedHeight > maxAllowedHeight) {
        calculatedHeight = maxAllowedHeight
        calculatedWidth = Math.max(360, Math.round(calculatedHeight * (420 / 600)))
      }

      return {
        width: calculatedWidth,
        height: calculatedHeight,
      }
    }

    return {
      width: Math.min(420, window.innerWidth - 32),
      height: Math.min(600, window.innerHeight - 80),
    }
  }

  // 计算弹窗生效坐标（支持拖拽定位、最大化右侧 1/3 停靠与初始自适应锚定）
  const getEffectiveDialogPosition = () => {
    const { width: dialogW, height: dialogH } = getDialogDimensions()

    if (typeof window === 'undefined') {
      return { x: 100, y: 100, width: dialogW, height: dialogH }
    }

    if (isMaximized) {
      // 最大化时严格停靠在屏幕右侧 (占右边 1/3 区域，留 16px 呼吸间距，垂直居中)
      const x = Math.max(16, window.innerWidth - dialogW - 16)
      const y = Math.max(16, Math.floor((window.innerHeight - dialogH) / 2))
      return { x, y, width: dialogW, height: dialogH }
    }

    if (dialogPosition !== null) {
      // 保证在屏幕内
      const clampedX = Math.min(Math.max(12, dialogPosition.x), Math.max(12, window.innerWidth - dialogW - 12))
      const clampedY = Math.min(Math.max(12, dialogPosition.y), Math.max(12, window.innerHeight - dialogH - 12))
      return { x: clampedX, y: clampedY, width: dialogW, height: dialogH }
    }

    // 默认初始位置：紧密贴合小人
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
      defaultY = Math.max(16, mascotTop - dialogH - 14)
    } else {
      defaultY = Math.min(window.innerHeight - dialogH - 16, mascotTop + MASCOT_SIZE + 14)
    }

    return { x: defaultX, y: defaultY, width: dialogW, height: dialogH }
  }

  // 双击顶部标题栏切换最大化 / 还原
  const handleDialogHeaderDoubleClick = () => {
    setIsMaximized((prev) => !prev)
    playSound(SoundType.Click)
  }

  // 弹窗顶部栏拖拽事件
  const handleDialogHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isMaximized) return

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
      const nextX = Math.min(
        Math.max(12, dialogDragRef.current.dialogStartX + dx),
        Math.max(12, window.innerWidth - curW - 12),
      )
      const nextY = Math.min(
        Math.max(12, dialogDragRef.current.dialogStartY + dy),
        Math.max(12, window.innerHeight - curH - 12),
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

  const handleSend = () => {
    if (!assistantInput.trim() || isAssistantResponding) return
    playSound(SoundType.Click)
    void sendAssistantMessage()
  }

  const handleKeyDownInInput = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  const handleInsertCommand = (cmd: string) => {
    window.dispatchEvent(
      new CustomEvent('insert-terminal-command', {
        detail: { command: cmd, execute: false },
      }),
    )
    setInsertedCode(cmd)
    playSound(SoundType.Success)
    setTimeout(() => setInsertedCode(null), 2000)
  }

  const CAPABILITY_CARDS = [
    {
      id: 'diagnosis',
      title: '异常诊断',
      desc: '实例无法连接、服务崩溃根因分析',
      prompt: '请帮我诊断服务器无法连接且 SSH 超时的排查步骤与解决方案',
      icon: ShieldAlert,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10 hover:bg-blue-500/15 border-blue-500/20',
    },
    {
      id: 'ops',
      title: '操作运维',
      desc: '端口管理、进程杀死、权限修复',
      prompt: '如何查找并杀死占用特定端口的进程，并修复文件执行权限？',
      icon: Layers,
      color: 'text-indigo-500',
      bgColor: 'bg-indigo-500/10 hover:bg-indigo-500/15 border-indigo-500/20',
    },
    {
      id: 'monitor',
      title: '监控分析',
      desc: 'CPU/内存高负载排查、网络分析',
      prompt: '如何排查 Linux 服务器 CPU 负载 100% 的进程与内存泄漏？',
      icon: BarChart3,
      color: 'text-cyan-500',
      bgColor: 'bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/20',
    },
    {
      id: 'deploy',
      title: '服务部署',
      desc: 'Docker 容器、Nginx 反代脚本',
      prompt: '请写一份通用的 Docker 容器与 Nginx 反向代理配置及快速启动脚本',
      icon: Rocket,
      color: 'text-sky-500',
      bgColor: 'bg-sky-500/10 hover:bg-sky-500/15 border-sky-500/20',
    },
    {
      id: 'resource',
      title: '资源查询',
      desc: '磁盘空间清理、大文件定位',
      prompt: '服务器磁盘空间满了，如何快速检索大于 100MB 的大文件并安全清理？',
      icon: HardDrive,
      color: 'text-blue-600',
      bgColor: 'bg-blue-600/10 hover:bg-blue-600/15 border-blue-600/20',
    },
    {
      id: 'recommend',
      title: '方案建议',
      desc: 'Linux 生产安全基线加固与性能调优',
      prompt: '如何为新的 Linux 服务器配置安全基线加固（SSH 密钥登录、防火墙、非 root 用户）？',
      icon: Lightbulb,
      color: 'text-violet-500',
      bgColor: 'bg-violet-500/10 hover:bg-violet-500/15 border-violet-500/20',
    },
  ]

  const RECOMMEND_PILLS = [
    { text: '实例无法连接怎么办？', prompt: '实例无法连接，SSH 报 Connection timed out，如何一步步排查？' },
    { text: '实例状态卡在“停止中”，如何解决？', prompt: '云服务器实例或守护进程卡在“停止中 (Stopping)”，如何排查强制释放？' },
    { text: '云盘/磁盘空间满了怎么清理？', prompt: 'Linux 根分区磁盘空间利用率 100%，怎么查找大文件并安全释放空间？' },
    { text: '端口被占用如何快速排查？', prompt: '如何使用 ss 和 lsof 命令排查指定端口被哪个进程占用并优雅重启？' },
  ]

  const dialogLayout = getEffectiveDialogPosition()

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
          className={cn(
            'select-none touch-none rounded-full',
            isMascotDragging ? 'cursor-grabbing transition-none' : 'cursor-grab transition-transform duration-200',
            isFloatingAssistantOpen
              ? 'scale-90 opacity-40 hover:opacity-100'
              : 'scale-100 opacity-100 hover:scale-105 active:scale-95',
          )}
        >
          <div className="relative rounded-full">
            {/* 外圈微光呼吸光晕 (纯圆形柔光，无任何方形投影) */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 opacity-30 blur-md pointer-events-none animate-pulse" />

            {/* 纯圆形吉祥物主体 */}
            <AIMascotAvatar
              size={MASCOT_SIZE}
              mood={assistantMascotMood}
              showGlowRing={true}
              interactive={!isMascotDragging}
              className="relative rounded-full drop-shadow-lg"
            />

            {/* 待机小呼吸点 */}
            {!isFloatingAssistantOpen && (
              <span className="absolute top-0 right-0 flex h-2.5 w-2.5 pointer-events-none">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500 ring-2 ring-background" />
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. 点击弹出的 AI 助手窗口面板 (支持任意拖拽，比例舒适宽屏) */}
      {isFloatingAssistantOpen && (
        <div
          data-testid="ai-assistant-dialog"
          style={{
            position: 'fixed',
            left: `${dialogLayout.x}px`,
            top: `${dialogLayout.y}px`,
            width: `${dialogLayout.width}px`,
            height: `${dialogLayout.height}px`,
            zIndex: 50,
          }}
          className={cn(
            'flex flex-col overflow-hidden bg-background/95 backdrop-blur-2xl border border-border/80 shadow-2xl rounded-2xl select-text animate-in fade-in zoom-in-95',
            isDialogDragging ? 'transition-none shadow-cyan-500/10' : 'transition-all duration-200',
          )}
        >
          {/* Header 顶部拖拽栏 */}
          <div
            onPointerDown={handleDialogHeaderPointerDown}
            onDoubleClick={handleDialogHeaderDoubleClick}
            className={cn(
              'flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/25 select-none shrink-0',
              isMaximized ? 'cursor-default' : 'cursor-move hover:bg-muted/40 transition-colors',
            )}
          >
            {/* 左侧：小人微标 + 标题 + 拖拽手柄指示器 */}
            <div className="flex items-center gap-2">
              <AIMascotAvatar size={24} mood={assistantMascotMood} showGlowRing={false} interactive={false} />
              <span className="text-xs font-bold text-foreground">
                {t('ai_assistant_title') || '运维小助手'}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-normal bg-primary/10 text-primary">
                AIOps Copilot
              </span>
              {!isMaximized && (
                <div className="hidden sm:flex items-center text-muted-foreground/40 ml-1">
                  <GripHorizontal className="h-3.5 w-3.5" />
                </div>
              )}
            </div>

            {/* 右侧：功能控制按钮 (阻止向上传递拖拽) */}
            <div
              className="flex items-center gap-1 text-muted-foreground"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* 新建对话按钮 (+) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      clearAssistantMessages()
                      playSound(SoundType.Click)
                    }}
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  新建对话
                </TooltipContent>
              </Tooltip>

              {/* 历史记录按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => playSound(SoundType.Click)}
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  会话记录
                </TooltipContent>
              </Tooltip>

              {/* 最大化 / 还原切换 (占右边 1/3，比例不变) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="ai-maximize-toggle-btn"
                    aria-label={
                      isMaximized
                        ? t('ai_restore_btn') || '还原窗口'
                        : t('ai_maximize_btn') || '最大化 (右侧 1/3 等比例)'
                    }
                    onClick={() => {
                      setIsMaximized(!isMaximized)
                      playSound(SoundType.Click)
                    }}
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {isMaximized ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {isMaximized
                    ? t('ai_restore_btn') || '还原窗口'
                    : t('ai_maximize_btn') || '最大化 (右侧 1/3 等比例)'}
                </TooltipContent>
              </Tooltip>

              {/* 关闭/最小化按钮 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      playSound(SoundType.Close)
                      closeFloatingAssistant()
                    }}
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  关闭 (Esc)
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

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
          <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
            {assistantMessages.length === 0 ? (
              /* 空状态：2列横向功能卡片 + 热门推荐问答 Pills */
              <div className="flex flex-col space-y-4 pt-1 pb-2">
                {/* 顶部欢迎区：机器人插图 + 醒目标题 */}
                <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-transparent border border-primary/15">
                  <AIMascotAvatar size={60} mood={assistantMascotMood} showGlowRing={false} />
                  <div>
                    <h2 className="text-sm font-bold text-foreground tracking-tight">
                      您好，欢迎使用
                    </h2>
                    <h1 className="text-lg font-extrabold bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent">
                      {t('ai_assistant_title') || '运维小助手'}
                    </h1>
                  </div>
                </div>

                <div className="text-xs font-semibold text-muted-foreground px-0.5">
                  我可以帮您
                </div>

                {/* 6 大功能场景卡片 (2 列网格排布，宽度宽裕舒适) */}
                <div className="grid grid-cols-2 gap-3">
                  {CAPABILITY_CARDS.map((card) => {
                    const IconComponent = card.icon
                    return (
                      <div
                        key={card.id}
                        onClick={() => {
                          playSound(SoundType.Click)
                          void sendAssistantMessage(card.prompt)
                        }}
                        className={cn(
                          'p-3 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between group shadow-2xs hover:shadow-sm hover:-translate-y-0.5',
                          card.bgColor,
                        )}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div className={cn('p-1 rounded-md bg-background/80 shadow-2xs', card.color)}>
                            <IconComponent className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-xs font-bold text-foreground">
                            {card.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {card.desc}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {/* 推荐热门问题 Pills (带 # 前缀) */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {RECOMMEND_PILLS.map((pill, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        playSound(SoundType.Click)
                        void sendAssistantMessage(pill.prompt)
                      }}
                      className="inline-flex items-center text-[11px] px-2.5 py-1 rounded-lg bg-muted/40 hover:bg-primary/10 hover:text-primary text-muted-foreground border border-border/50 hover:border-primary/30 transition-all cursor-pointer text-left"
                    >
                      <span className="text-primary font-semibold mr-1">#</span>
                      <span>{pill.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* 会话流视图：支持富文本排版、代码块语法高亮与"填入终端" */
              <div className="space-y-4">
                {assistantMessages.map((msg) => {
                  const isUser = msg.role === 'user'

                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        'flex gap-2.5 items-start',
                        isUser ? 'flex-row-reverse justify-start' : 'justify-start',
                      )}
                    >
                      {/* 头像 */}
                      {!isUser ? (
                        <div className="shrink-0 mt-0.5">
                          <AIMascotAvatar
                            size={28}
                            mood={msg.status === 'error' ? 'blink' : 'idle'}
                            showGlowRing={false}
                            interactive={false}
                          />
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 shadow-2xs">
                          我
                        </div>
                      )}

                      {/* 气泡正文 */}
                      <div
                        className={cn(
                          'rounded-2xl text-xs leading-relaxed max-w-[88%] px-4 py-3 shadow-2xs',
                          isUser
                            ? 'bg-primary text-primary-foreground rounded-tr-xs font-normal'
                            : 'bg-muted/40 border border-border/60 text-foreground rounded-tl-xs space-y-2',
                        )}
                      >
                        {/* Agent/Chat 模式标签 */}
                        {!isUser && msg.mode && (
                          <div className="flex items-center gap-1.5 pb-1 border-b border-border/40 text-[10px] text-muted-foreground font-medium">
                            {msg.mode === 'agent' ? (
                              <>
                                <Sparkles className="h-3 w-3 text-cyan-500" />
                                <span>Agent 运维执行</span>
                              </>
                            ) : (
                              <>
                                <MessageSquare className="h-3 w-3 text-blue-500" />
                                <span>Chat 咨询解答</span>
                              </>
                            )}
                          </div>
                        )}

                        {/* 文本内容与交互式代码块 */}
                        {isUser ? (
                          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                        ) : (
                          <AssistantMessageRenderer
                            content={msg.content}
                            onCopy={handleCopyCommand}
                            onInsert={handleInsertCommand}
                            copiedCode={copiedCode}
                            insertedCode={insertedCode}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* 思考中/生成中状态 */}
                {isAssistantResponding && (
                  <div className="flex gap-2.5 items-start">
                    <div className="shrink-0 mt-0.5">
                      <AIMascotAvatar size={28} mood="thinking" showGlowRing={false} interactive={false} />
                    </div>
                    <div className="p-3 rounded-2xl rounded-tl-xs bg-muted/40 border border-border/60 text-xs text-muted-foreground flex items-center gap-2">
                      <div className="flex space-x-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce" />
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce delay-100" />
                        <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-bounce delay-200" />
                      </div>
                      <span>AI 助手正在深度推导中...</span>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Bottom 输入区域 */}
          <div className="p-3 border-t border-border/60 bg-muted/15 shrink-0 space-y-2">
            {/* 输入框主卡片 */}
            <div className="relative rounded-xl border border-border/80 bg-background shadow-xs focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all p-2.5 flex flex-col justify-between min-h-[96px]">
              {/* Textarea 多行自适应输入 */}
              <textarea
                ref={textareaRef}
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                onKeyDown={handleKeyDownInInput}
                placeholder="你可以输入任何运维排障、命令生成或脚本问题..."
                rows={2}
                className="w-full bg-transparent resize-none outline-none text-xs text-foreground placeholder:text-muted-foreground/60 leading-relaxed max-h-[120px]"
              />

              {/* 输入框底部动作条：左侧 Agent/Chat 切换，右侧向上箭头发送按钮 */}
              <div className="flex items-center justify-between pt-2">
                {/* 模式切换胶囊 */}
                <div className="flex items-center p-0.5 rounded-lg bg-muted/60 border border-border/50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAssistantMode('agent')
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer',
                      assistantMode === 'agent'
                        ? 'bg-background text-primary shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Sparkles className="h-3 w-3 text-cyan-500" />
                    <span>Agent</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAssistantMode('chat')
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer',
                      assistantMode === 'chat'
                        ? 'bg-background text-primary shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <MessageSquare className="h-3 w-3 text-blue-500" />
                    <span>Chat</span>
                  </button>
                </div>

                {/* 发送按钮 */}
                <Button
                  type="button"
                  size="icon"
                  disabled={!assistantInput.trim() || isAssistantResponding}
                  onClick={handleSend}
                  className={cn(
                    'h-7 w-7 rounded-lg transition-all duration-200 cursor-pointer',
                    assistantInput.trim() && !isAssistantResponding
                      ? 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:scale-105 active:scale-95'
                      : 'bg-muted text-muted-foreground opacity-50 cursor-not-allowed',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 底部免责声明小字 */}
            <div className="text-[10px] text-muted-foreground/60 text-center select-none">
              内容由 AI 生成，仅供参考，您据此所作判断及操作均由您自行承担责任。
            </div>
          </div>
        </div>
      )}
    </>
  )
}
