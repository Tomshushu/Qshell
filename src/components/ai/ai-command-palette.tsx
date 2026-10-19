/**
 * src/components/ai/ai-command-palette.tsx
 *
 * Qshell AIOps 自然语言智能指令生成面板
 * 用户输入自然语言运维意图，AI 实时生成带逐项参数解释的精准 Shell 命令
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslation } from '@/i18n'
import { useAIStore } from '@/store/ai-store'
import {
  Sparkles,
  Terminal,
  Loader2,
  Copy,
  Check,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { playSound, SoundType } from '@/lib/sound'

interface AICommandPaletteProps {
  onInsertToTerminal?: (command: string) => void
}

export function AICommandPalette({ onInsertToTerminal }: AICommandPaletteProps) {
  const { t } = useTranslation()
  const {
    enableAiGlobal,
    isCommandPaletteOpen,
    closeCommandPalette,
    isGeneratingCommand,
    generatedCommandResult,
    commandGenerationError,
    runGenerateCommand,
  } = useAIStore()

  const [intentInput, setIntentInput] = useState('')
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setIntentInput('')
      setCopied(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isCommandPaletteOpen])

  if (!enableAiGlobal) {
    return null
  }

  const handleGenerate = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!intentInput.trim() || isGeneratingCommand) return
    void runGenerateCommand(intentInput.trim())
  }

  const handleCopy = () => {
    if (!generatedCommandResult?.command) return
    navigator.clipboard.writeText(generatedCommandResult.command)
    setCopied(true)
    playSound(SoundType.Click)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleInsert = () => {
    if (!generatedCommandResult?.command || generatedCommandResult.risk.isBlocked) return
    if (onInsertToTerminal) {
      onInsertToTerminal(generatedCommandResult.command)
      playSound(SoundType.Success)
      closeCommandPalette()
    }
  }

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={(open) => !open && closeCommandPalette()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden bg-background border border-border/80 rounded-xl shadow-2xl gap-0">
        <DialogHeader className="p-4 px-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground">
                {t('ai_command_palette_title')}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                {t('ai_command_palette_desc')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {/* 输入意图表单 */}
          <form onSubmit={handleGenerate} className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={intentInput}
              onChange={(e) => setIntentInput(e.target.value)}
              placeholder={t('ai_intent_placeholder')}
              className="h-9 text-xs flex-1"
            />
            <Button
              type="submit"
              size="sm"
              disabled={isGeneratingCommand || !intentInput.trim()}
              className="h-9 px-3 text-xs gap-1.5 shrink-0"
            >
              {isGeneratingCommand ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('ai_generating')}</span>
                </>
              ) : (
                <>
                  <span>{t('ai_generate_btn')}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </form>

          {/* 错误提示 */}
          {commandGenerationError && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{commandGenerationError}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai' }))
                  closeCommandPalette()
                }}
                className="h-6 text-[11px] gap-1 bg-background text-foreground hover:bg-accent"
              >
                <Sparkles className="h-3 w-3 text-primary" />
                <span>{t('ai_go_to_config_btn')}</span>
              </Button>
            </div>
          )}

          {/* 生成结果卡片 */}
          {generatedCommandResult && (
            <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {generatedCommandResult.risk.level === 'safe' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                        <ShieldCheck className="h-3 w-3" />
                        {t('ai_risk_safe')}
                      </span>
                    )}
                    {generatedCommandResult.risk.level === 'notice' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                        <ShieldAlert className="h-3 w-3" />
                        {t('ai_risk_notice')}
                      </span>
                    )}
                    {generatedCommandResult.risk.level === 'dangerous' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                        <ShieldX className="h-3 w-3" />
                        {t('ai_risk_dangerous')}
                      </span>
                    )}
                    {generatedCommandResult.risk.level === 'blocked' && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground font-bold">
                        {t('ai_risk_blocked')}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-foreground">
                      {t('ai_suggested_command_title')}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCopy}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 mr-1 text-emerald-500" />
                          <span>{t('copied')}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 mr-1" />
                          <span>{t('copy')}</span>
                        </>
                      )}
                    </Button>

                    {!generatedCommandResult.risk.isBlocked && onInsertToTerminal && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleInsert}
                        className="h-6 px-2 text-[11px] font-medium gap-1 text-primary hover:bg-primary/10"
                      >
                        <Terminal className="h-3 w-3" />
                        <span>{t('ai_insert_to_terminal')}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* 待执行命令 */}
                <div className="p-2.5 rounded-lg bg-background border border-border/70 font-mono text-xs text-foreground select-text whitespace-pre-wrap break-all">
                  {generatedCommandResult.command}
                </div>

                {/* 解释说明 */}
                {generatedCommandResult.explanation && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pl-1">
                    {generatedCommandResult.explanation}
                  </p>
                )}

                {/* 风险告警说明 */}
                {generatedCommandResult.risk.reasons.length > 0 &&
                  generatedCommandResult.risk.level !== 'safe' && (
                    <div className="text-[10px] text-amber-500/90 flex items-center gap-1 pl-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>{generatedCommandResult.risk.reasons.join('；')}</span>
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
