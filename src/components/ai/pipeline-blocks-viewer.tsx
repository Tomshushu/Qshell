/**
 * src/components/ai/pipeline-blocks-viewer.tsx
 *
 * 复杂管道与天书指令乐高积木式可视化流转组件 (Lego Pipeline Blocks Viewer)
 *
 * 核心特性：
 * 1. 乐高色块分段卡片 (Step 1 蓝, Step 2 紫, Step 3 青, Step 4 橙, Step 5 绿等)；
 * 2. 管道流动指示 (带动态脉冲箭头与中间数据流状态说明)；
 * 3. 命令行参数胶囊拆解 (Flag Pills)；
 * 4. 零信任生产风险护盾标识 (0 风险只读白名单 / 破坏性警告)；
 * 5. 单段代码复制与完整指令一键复用。
 */

import React, { useState } from 'react'
import {
  Layers,
  ArrowDown,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  Terminal,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ShellPipelineExplainResult } from '@/types/ai'

export interface PipelineBlocksViewerProps {
  data: ShellPipelineExplainResult
  onCopyToTerminal?: (command: string) => void
  className?: string
}

// 乐高色系阶梯配置：蓝 ➔ 紫 ➔ 青 ➔ 橙 ➔ 绿 ➔ 玫瑰红
const LEGO_THEMES = [
  {
    border: 'border-sky-500/30',
    bg: 'bg-sky-500/5 dark:bg-sky-500/10',
    badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/25',
    accent: 'bg-sky-500',
    text: 'text-sky-600 dark:text-sky-400',
  },
  {
    border: 'border-purple-500/30',
    bg: 'bg-purple-500/5 dark:bg-purple-500/10',
    badge: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25',
    accent: 'bg-purple-500',
    text: 'text-purple-600 dark:text-purple-400',
  },
  {
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5 dark:bg-cyan-500/10',
    badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
    accent: 'bg-cyan-500',
    text: 'text-cyan-600 dark:text-cyan-400',
  },
  {
    border: 'border-amber-500/30',
    bg: 'bg-amber-500/5 dark:bg-amber-500/10',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
    accent: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5 dark:bg-emerald-500/10',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    accent: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    border: 'border-rose-500/30',
    bg: 'bg-rose-500/5 dark:bg-rose-500/10',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
    accent: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
]

export function PipelineBlocksViewer({
  data,
  onCopyToTerminal,
  className,
}: PipelineBlocksViewerProps) {
  const [copiedFull, setCopiedFull] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [showAiDetail, setShowAiDetail] = useState(true)

  const handleCopyFull = () => {
    void navigator.clipboard.writeText(data.fullCommand)
    setCopiedFull(true)
    setTimeout(() => setCopiedFull(false), 2000)
  }

  const handleCopySegment = (cmd: string, idx: number) => {
    void navigator.clipboard.writeText(cmd)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 1800)
  }

  return (
    <div
      data-testid="pipeline-blocks-viewer"
      className={cn(
        'my-3 rounded-2xl border border-border/60 bg-card/90 dark:bg-zinc-900/90 backdrop-blur-md shadow-md overflow-hidden text-xs text-foreground transition-all',
        className,
      )}
    >
      {/* 顶部全局横幅：指令概述与安全评级 */}
      <div className="px-4 py-3 border-b border-border/50 bg-muted/30 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h4 className="font-semibold text-sm flex items-center gap-1.5 text-foreground">
                <span>指令乐高积木式拆解</span>
                <span className="text-[10.5px] font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono">
                  {data.steps.length} 个流转步骤
                </span>
              </h4>
            </div>
          </div>

          {/* 复制完整指令按钮 */}
          <button
            type="button"
            onClick={handleCopyFull}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/60 bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] transition-colors cursor-pointer select-none"
            title="复制完整复合指令"
          >
            {copiedFull ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" />
                <span className="text-emerald-500 font-medium">已复制完整命令</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                <span>复制完整命令</span>
              </>
            )}
          </button>
        </div>

        {/* 业务总结一句话 */}
        <p className="text-[11.5px] text-muted-foreground leading-relaxed">
          {data.summary}
        </p>

        {/* 安全风险护盾标识 */}
        <div className="flex items-center gap-2 pt-0.5">
          {data.hasDestructiveRisk ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-destructive/15 text-destructive border border-destructive/25 text-[11px] font-medium">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>⚠️ 警告：该指令包含写操作/修改/删除行为，执行前请务必确认目标路径！</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.8 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10.5px] font-medium">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span>🛡️ 纯只读数据流处理 (0 生产风险，可放心学习与执行)</span>
            </div>
          )}
        </div>
      </div>

      {/* 乐高积木流转区 */}
      <div className="p-4 space-y-2.5">
        {data.steps.map((step, idx) => {
          const theme = LEGO_THEMES[idx % LEGO_THEMES.length]
          const isLast = idx === data.steps.length - 1
          const isCopied = copiedIdx === idx

          return (
            <React.Fragment key={step.stepIndex ?? idx}>
              {/* 单块乐高积木 */}
              <div
                data-testid={`lego-step-${step.stepIndex}`}
                className={cn(
                  'rounded-xl border p-3 transition-all relative overflow-hidden group shadow-2xs',
                  theme.border,
                  theme.bg,
                )}
              >
                {/* 积木左侧立体卡槽色条 */}
                <div
                  className={cn(
                    'absolute left-0 top-0 bottom-0 w-1.5 rounded-l',
                    theme.accent,
                  )}
                />

                <div className="pl-1.5 space-y-2">
                  {/* 积木头部：序号、工具标签与动作 */}
                  <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-1.5 select-none">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* 步骤徽章 */}
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[10.5px] font-mono font-bold tracking-tight border shrink-0',
                          theme.badge,
                        )}
                      >
                        STEP {String(step.stepIndex).padStart(2, '0')}
                      </span>

                      {/* 核心动作通俗说明 */}
                      <span className="font-medium text-[11.5px] text-foreground truncate">
                        {step.actionDescription}
                      </span>
                    </div>

                    {/* 单步复制 */}
                    <button
                      type="button"
                      onClick={() => handleCopySegment(step.rawCommand, idx)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                      title="仅复制本步骤命令"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-2.5 w-2.5 text-emerald-500" />
                          <span className="text-emerald-500">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-2.5 w-2.5" />
                          <span>复制此段</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* 命令行高亮小暗黑代码块 */}
                  <div className="rounded-lg bg-[#141418] dark:bg-[#0c0c0e] border border-white/5 p-2 font-mono text-[11px] text-zinc-100 flex items-center justify-between gap-2 overflow-x-auto selection:bg-primary/30">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Terminal className={cn('h-3 w-3 shrink-0', theme.text)} />
                      <code className="truncate">{step.rawCommand}</code>
                    </div>
                  </div>

                  {/* 参数拆解胶囊 (Flag Pills) */}
                  {step.flagsExplanation && step.flagsExplanation.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {step.flagsExplanation.map((f, fIdx) => (
                        <div
                          key={fIdx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-background/80 dark:bg-black/40 border border-border/50 text-[10.5px] text-muted-foreground"
                        >
                          <span className={cn('font-mono font-semibold', theme.text)}>
                            {f.flag}
                          </span>
                          <span className="text-[10px] text-foreground/80">
                            {f.meaning}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 单步风险提示 */}
                  {step.riskLevel !== 'safe' && step.riskReason && (
                    <div className="p-1.5 rounded-md bg-destructive/10 text-destructive text-[10px] flex items-center gap-1 leading-tight">
                      <ShieldAlert className="h-3 w-3 shrink-0" />
                      <span>{step.riskReason}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 积木间管道流向下行连接线 (带有流动感) */}
              {!isLast && (
                <div className="flex items-center justify-center my-0.5 py-0.5 select-none">
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/40 border border-border/40 text-[10px] text-muted-foreground shadow-2xs">
                    <ArrowDown className="h-3 w-3 text-primary animate-bounce shrink-0" />
                    <span className="font-mono">
                      {data.steps[idx + 1]?.dataFlowDescription || '管道流转输出'}
                    </span>
                  </div>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>

      {/* AI 深度业务解说与性能建议 (若可用) */}
      {data.aiExplanation && (
        <div className="px-4 py-3 border-t border-border/40 bg-primary/5 space-y-2">
          <div
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setShowAiDetail(!showAiDetail)}
          >
            <div className="flex items-center gap-1.5 text-primary font-medium text-[11.5px]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI 深度语义与调优建议</span>
            </div>
            {showAiDetail ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>

          {showAiDetail && (
            <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap pl-5 border-l-2 border-primary/30">
              {data.aiExplanation}
            </p>
          )}
        </div>
      )}

      {/* 底部操作工具栏 */}
      {onCopyToTerminal && (
        <div className="px-4 py-2 border-t border-border/40 bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
            <Info className="h-3 w-3" />
            <span>可在左侧终端粘贴执行或分段测试</span>
          </div>

          <button
            type="button"
            onClick={() => onCopyToTerminal(data.fullCommand)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium transition-colors cursor-pointer shadow-2xs"
          >
            <Terminal className="h-3 w-3" />
            <span>输入至当前终端</span>
          </button>
        </div>
      )}
    </div>
  )
}
