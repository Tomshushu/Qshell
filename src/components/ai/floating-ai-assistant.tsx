/**
 * src/components/ai/floating-ai-assistant.tsx
 *
 * Qshell 全局悬浮 AI 助手组件 (Floating AI Assistant & Copilot Mascot)
 * 1. 悬浮吉祥物小人：蓝白科技感小机器人，支持待机眨眼、微光扫掠与 hover 笑眼动画
 * 2. 对话弹出面板：严格参考阿里云计算 AI 助手设计，包含 6 大运维场景卡片、快捷 prompt pills、Agent/Chat 双模式与流式对话
 * 3. 终端无缝协同：支持一键将推荐命令填入当前活跃终端并执行
 */

import React, { useState, useRef, useEffect } from 'react'
import { useAIStore } from '@/store/ai-store'
import { AIMascotAvatar } from './ai-mascot-avatar'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import {
  Sparkles,
  MessageSquare,
  ArrowUp,
  Plus,
  History,
  X,
  Minus,
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
  AlertCircle,
  HelpCircle,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AIAssistantMode, AIAssistantMessage } from '@/types/ai'

export function FloatingAIAssistant() {
  const { t } = useTranslation()
  const {
    showFloatingMascot,
    isFloatingAssistantOpen,
    openFloatingAssistant,
    closeFloatingAssistant,
    toggleFloatingAssistant,
    assistantMode,
    setAssistantMode,
    assistantMessages,
    isAssistantResponding,
    assistantInput,
    setAssistantInput,
    assistantMascotMood,
    setAssistantMascotMood,
    sendAssistantMessage,
    clearAssistantMessages,
  } = useAIStore()

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [insertedId, setInsertedId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 快捷键支持：Ctrl+Alt+A / Cmd+Alt+A 切换 AI 助手
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [isFloatingAssistantOpen, openFloatingAssistant, closeFloatingAssistant])

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

  if (!showFloatingMascot) {
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

  const handleCopyCommand = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedId(id)
    playSound(SoundType.Click)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleInsertCommand = (cmd: string, id: string) => {
    window.dispatchEvent(
      new CustomEvent('insert-terminal-command', {
        detail: { command: cmd, execute: false },
      }),
    )
    setInsertedId(id)
    playSound(SoundType.Success)
    setTimeout(() => setInsertedId(null), 2000)
  }

  // 6 大核心场景卡片配置（严格对齐图片 4）
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

  // 推荐热门问题标签 Pills（参考图片 4）
  const RECOMMEND_PILLS = [
    { text: '实例无法连接怎么办？', prompt: '实例无法连接，SSH 报 Connection timed out，如何一步步排查？' },
    { text: '实例状态卡在“停止中”，如何解决？', prompt: '云服务器实例或守护进程卡在“停止中 (Stopping)”，如何排查强制释放？' },
    { text: '云盘/磁盘空间满了怎么清理？', prompt: 'Linux 根分区磁盘空间利用率 100%，怎么查找大文件并安全释放空间？' },
    { text: '端口被占用如何快速排查？', prompt: '如何使用 ss 和 lsof 命令排查指定端口被哪个进程占用并优雅重启？' },
  ]

  return (
    <>
      {/* 1. 全局悬浮机器人吉祥物按钮 (Mascot Floating Button) */}
      <div
        className={cn(
          'fixed bottom-12 right-6 z-40 select-none transition-all duration-300 ease-out',
          isFloatingAssistantOpen ? 'scale-90 opacity-40 hover:opacity-100' : 'scale-100 opacity-100',
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative group">
              {/* 外圈微光呼吸光晕 */}
              <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 opacity-40 blur-md group-hover:opacity-75 transition duration-500 group-hover:duration-200 animate-pulse" />

              <AIMascotAvatar
                size={54}
                mood={assistantMascotMood}
                showGlowRing={true}
                interactive={true}
                onClick={handleToggle}
                className="relative shadow-xl hover:shadow-cyan-500/20"
              />

              {/* 待机小呼吸点 */}
              {!isFloatingAssistantOpen && (
                <span className="absolute top-0 right-0 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500 ring-2 ring-background" />
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs py-1.5 px-3">
            <div className="font-semibold flex items-center gap-1.5">
              <span>{t('ai_assistant_title') || '计算 AI 助手'}</span>
              <span className="text-[10px] text-primary bg-primary/10 px-1 py-0.2 rounded">Ctrl+Alt+A</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              点击唤起终端 Copilot 智能运维小人
            </div>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* 2. 点击弹出的 AI 助手窗口面板 (Popup Assistant Dialog) */}
      {isFloatingAssistantOpen && (
        <div
          className={cn(
            'fixed right-6 z-50 flex flex-col overflow-hidden bg-background/95 backdrop-blur-2xl border border-border/80 shadow-2xl rounded-2xl transition-all duration-200 animate-in fade-in zoom-in-95 slide-in-from-bottom-4',
            isExpanded
              ? 'bottom-6 top-6 w-[620px] max-w-[calc(100vw-48px)]'
              : 'bottom-24 w-[420px] max-w-[calc(100vw-32px)] h-[620px] max-h-[calc(100vh-120px)]',
          )}
        >
          {/* Header 顶部栏 (严格匹配参考图：标题 + 新建 + 历史 + 反馈 + 最小化/关闭) */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/20 select-none shrink-0">
            {/* 左侧：小人微标 + 标题 */}
            <div className="flex items-center gap-2">
              <AIMascotAvatar size={24} mood={assistantMascotMood} showGlowRing={false} interactive={false} />
              <span className="text-xs font-bold text-foreground">
                {t('ai_assistant_title') || '计算 AI 助手'}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-normal bg-primary/10 text-primary">
                AIOps Copilot
              </span>
            </div>

            {/* 右侧：功能控制按钮 */}
            <div className="flex items-center gap-1 text-muted-foreground">
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
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
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
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <History className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  会话记录
                </TooltipContent>
              </Tooltip>

              {/* 宽屏展开/收缩切换 */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setIsExpanded(!isExpanded)
                      playSound(SoundType.Click)
                    }}
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {isExpanded ? '收起窗口' : '展开宽屏'}
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
                    className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
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

          {/* Body 消息与空状态区域 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
            {assistantMessages.length === 0 ? (
              /* 空状态：精准还原参考图片 4 的 欢迎区 + 6大卡片 + 推荐标签 */
              <div className="flex flex-col space-y-4 pt-2 pb-2">
                {/* 顶部欢迎区：机器人插图 + 大标题 */}
                <div className="flex items-center gap-3.5 p-3 rounded-xl bg-gradient-to-r from-primary/5 via-primary/10 to-transparent border border-primary/15">
                  <AIMascotAvatar size={64} mood={assistantMascotMood} showGlowRing={false} />
                  <div>
                    <h2 className="text-base font-bold text-foreground tracking-tight">
                      您好，欢迎使用
                    </h2>
                    <h1 className="text-xl font-extrabold bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 bg-clip-text text-transparent">
                      AI 助手
                    </h1>
                  </div>
                </div>

                {/* 副标题：我可以帮您 */}
                <div className="text-xs font-semibold text-muted-foreground px-0.5">
                  我可以帮您
                </div>

                {/* 6 大功能场景卡片 (2 列网格) */}
                <div className="grid grid-cols-2 gap-2.5">
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
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className={cn('p-1 rounded-md bg-background/80 shadow-2xs', card.color)}>
                            <IconComponent className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-xs font-bold text-foreground">
                            {card.title}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                          {card.desc}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {/* 推荐热门问题 Pills (带 # 前缀，对齐图片 4) */}
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
              /* 会话流视图：支持多轮对话、流式文字、代码高亮与"填入终端" */
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
                          'rounded-2xl text-xs leading-relaxed max-w-[85%] px-3.5 py-2.5 shadow-2xs',
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

                        {/* 文本内容 */}
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>

                        {/* 建议命令卡片与"填入终端"操作 */}
                        {!isUser && msg.suggestedCommands && msg.suggestedCommands.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <div className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                              <Terminal className="h-3 w-3 text-primary" />
                              <span>推荐执行命令</span>
                            </div>

                            {msg.suggestedCommands.map((cmdItem, cIdx) => {
                              const cmdId = `${msg.id}_cmd_${cIdx}`
                              const isCopied = copiedId === cmdId
                              const isInserted = insertedId === cmdId

                              return (
                                <div
                                  key={cIdx}
                                  className="p-2 rounded-lg bg-background/80 border border-border/70 space-y-1.5"
                                >
                                  {cmdItem.explanation && (
                                    <div className="text-[11px] text-muted-foreground">
                                      {cmdItem.explanation}
                                    </div>
                                  )}

                                  <div className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/60 font-mono text-[11px] overflow-x-auto">
                                    <code className="text-foreground shrink-0">{cmdItem.command}</code>

                                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                                      {/* 复制命令 */}
                                      <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleCopyCommand(cmdItem.command, cmdId)}
                                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                        title="复制命令"
                                      >
                                        {isCopied ? (
                                          <Check className="h-3 w-3 text-emerald-500" />
                                        ) : (
                                          <Copy className="h-3 w-3" />
                                        )}
                                      </Button>

                                      {/* 填入终端 */}
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleInsertCommand(cmdItem.command, cmdId)}
                                        className="h-6 px-2 text-[10px] gap-1 font-medium border-primary/30 hover:bg-primary hover:text-primary-foreground"
                                        title="将此命令写入当前活跃终端"
                                      >
                                        <Terminal className="h-3 w-3" />
                                        <span>{isInserted ? '已填入' : '填入终端'}</span>
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
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

          {/* Bottom 输入区域 (严格还原参考图片 4 的输入框卡片、Agent/Chat 胶囊与免责声明) */}
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
                {/* 模式切换胶囊 (✦ Agent / 💬 Chat，100% 对齐图片 4) */}
                <div className="flex items-center p-0.5 rounded-lg bg-muted/60 border border-border/50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setAssistantMode('agent')
                      playSound(SoundType.Click)
                    }}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer',
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
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer',
                      assistantMode === 'chat'
                        ? 'bg-background text-primary shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <MessageSquare className="h-3 w-3 text-blue-500" />
                    <span>Chat</span>
                  </button>
                </div>

                {/* 发送按钮 (圆形/圆角蓝底向上箭头，参考图片 4) */}
                <Button
                  type="button"
                  size="icon"
                  disabled={!assistantInput.trim() || isAssistantResponding}
                  onClick={handleSend}
                  className={cn(
                    'h-7 w-7 rounded-lg transition-all duration-200',
                    assistantInput.trim() && !isAssistantResponding
                      ? 'bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:scale-105 active:scale-95'
                      : 'bg-muted text-muted-foreground opacity-50 cursor-not-allowed',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 底部免责声明小字 (100% 对齐图片 4) */}
            <div className="text-[10px] text-muted-foreground/60 text-center select-none">
              内容由 AI 生成，仅供参考，您据此所作判断及操作均由您自行承担责任。
            </div>
          </div>
        </div>
      )}
    </>
  )
}
