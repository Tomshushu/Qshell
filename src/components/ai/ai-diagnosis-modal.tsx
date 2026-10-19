/**
 * src/components/ai/ai-diagnosis-modal.tsx
 *
 * Qshell AIOps 智能报错诊断与根因分析弹窗
 * 1. 结构化展示根因 (Root Cause)、详细推导分析与解决建议
 * 2. 推荐命令附带三级风险评级 (🟢 Level 1 / 🟡 Level 2 / 🔴 Level 3)
 * 3. 一键复制或直接填入当前活跃终端执行
 */

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useTranslation } from '@/i18n'
import { useAIStore } from '@/store/ai-store'
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  Terminal,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  FileText,
  CornerDownLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { playSound, SoundType } from '@/lib/sound'

interface AIDiagnosisModalProps {
  onInsertToTerminal?: (command: string) => void
}

export function AIDiagnosisModal({ onInsertToTerminal }: AIDiagnosisModalProps) {
  const { t } = useTranslation()
  const {
    enableAiGlobal,
    isDiagnosisModalOpen,
    closeDiagnosis,
    diagnosisSnippet,
    isDiagnosing,
    diagnosisResult,
    diagnosisError,
    runDiagnosis,
  } = useAIStore()

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  if (!enableAiGlobal) {
    return null
  }

  const handleCopy = (cmd: string, idx: number) => {
    navigator.clipboard.writeText(cmd)
    setCopiedIndex(idx)
    playSound(SoundType.Click)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const handleInsert = (cmd: string) => {
    if (onInsertToTerminal) {
      onInsertToTerminal(cmd)
      playSound(SoundType.Success)
      closeDiagnosis()
    }
  }

  return (
    <Dialog open={isDiagnosisModalOpen} onOpenChange={(open) => !open && closeDiagnosis()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background border border-border/80 rounded-xl shadow-2xl gap-0">
        {/* 顶部标题区 */}
        <DialogHeader className="p-4 px-5 border-b border-border/60 bg-muted/20 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span>{t('ai_diagnosis_title')}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-normal bg-primary/10 text-primary">
                    AIOps Copilot
                  </span>
                </DialogTitle>
                <DialogDescription className="text-[11px] text-muted-foreground mt-0.5">
                  {t('ai_diagnosis_desc')}
                </DialogDescription>
              </div>
            </div>

            <Button
              size="sm"
              variant="ghost"
              disabled={isDiagnosing}
              onClick={() => void runDiagnosis()}
              className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isDiagnosing && 'animate-spin')} />
              <span>{t('ai_re_diagnose')}</span>
            </Button>
          </div>
        </DialogHeader>

        {/* 主体滚动区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 1. 原始错误日志片段折叠卡片 */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>{t('ai_error_snippet_label')}</span>
            </div>
            <pre className="p-2.5 rounded-lg bg-muted/30 border border-border/50 text-[11px] font-mono text-muted-foreground max-h-24 overflow-y-auto whitespace-pre-wrap break-all select-text">
              {diagnosisSnippet || '无错误日志'}
            </pre>
          </div>

          {/* 诊断中 Loading */}
          {isDiagnosing && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center animate-in fade-in">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
                <Sparkles className="h-5 w-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {t('ai_diagnosing_in_progress')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('ai_diagnosing_hint')}
                </p>
              </div>
            </div>
          )}

          {/* 诊断失败报错 */}
          {!isDiagnosing && diagnosisError && (
            <Card className="border-destructive/30 bg-destructive/10 text-destructive p-4 rounded-xl">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <h4 className="text-xs font-semibold">{t('ai_diagnosis_failed')}</h4>
                  <p className="text-xs opacity-90 leading-relaxed">{diagnosisError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('open-settings', { detail: 'ai' }))
                      closeDiagnosis()
                    }}
                    className="h-7 text-xs gap-1.5 mt-1 bg-background text-foreground hover:bg-accent"
                  >
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>{t('ai_go_to_config_btn')}</span>
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* 诊断结果呈现 */}
          {!isDiagnosing && diagnosisResult && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* 核心根因 */}
              <Card className="border-primary/20 bg-primary/5 rounded-xl overflow-hidden shadow-xs">
                <CardContent className="p-3.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{t('ai_root_cause_title')}</span>
                  </div>
                  <p className="text-xs font-medium text-foreground leading-relaxed pl-5">
                    {diagnosisResult.rootCause}
                  </p>
                  {diagnosisResult.explanation && (
                    <p className="text-[11px] text-muted-foreground leading-relaxed pl-5 pt-1 border-t border-border/40">
                      {diagnosisResult.explanation}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* 解决建议 */}
              {diagnosisResult.suggestions.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-foreground">
                    {t('ai_suggestions_title')}
                  </span>
                  <ul className="space-y-1.5">
                    {diagnosisResult.suggestions.map((sug, i) => (
                      <li
                        key={i}
                        className="text-xs text-muted-foreground flex items-start gap-2 bg-muted/20 p-2 rounded-lg border border-border/40"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{sug}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 推荐排查或自愈命令 */}
              {diagnosisResult.recommendedCommands.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <span className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span>{t('ai_recommended_commands_title')}</span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {t('ai_commands_safety_badge')}
                    </span>
                  </span>

                  <div className="space-y-2">
                    {diagnosisResult.recommendedCommands.map((item, idx) => {
                      const { risk } = item
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-xl border border-border/60 bg-muted/20 space-y-2 hover:border-border transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              {risk.level === 'safe' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                                  <ShieldCheck className="h-3 w-3" />
                                  {t('ai_risk_safe')}
                                </span>
                              )}
                              {risk.level === 'notice' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                                  <ShieldAlert className="h-3 w-3" />
                                  {t('ai_risk_notice')}
                                </span>
                              )}
                              {risk.level === 'dangerous' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                                  <ShieldX className="h-3 w-3" />
                                  {t('ai_risk_dangerous')}
                                </span>
                              )}
                              {risk.level === 'blocked' && (
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground font-bold">
                                  {t('ai_risk_blocked')}
                                </span>
                              )}
                              <span className="text-[11px] text-muted-foreground truncate max-w-xs">
                                {item.explanation}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleCopy(item.command, idx)}
                                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                {copiedIndex === idx ? (
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

                              {!risk.isBlocked && onInsertToTerminal && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => handleInsert(item.command)}
                                  className="h-6 px-2 text-[11px] font-medium gap-1 text-primary hover:bg-primary/10"
                                >
                                  <Terminal className="h-3 w-3" />
                                  <span>{t('ai_insert_to_terminal')}</span>
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* 命令展示框 */}
                          <div className="flex items-center justify-between p-2 rounded-lg bg-background border border-border/60 font-mono text-xs text-foreground select-text">
                            <span className="overflow-x-auto whitespace-pre-wrap break-all pr-2">
                              {item.command}
                            </span>
                          </div>

                          {/* 风险告警说明 */}
                          {risk.reasons.length > 0 && risk.level !== 'safe' && (
                            <div className="text-[10px] text-amber-500/90 flex items-center gap-1 pl-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>{risk.reasons.join('；')}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮栏 */}
        <div className="p-3 px-5 border-t border-border/60 bg-muted/20 flex items-center justify-end gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={closeDiagnosis} className="h-8 text-xs">
            {t('close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
