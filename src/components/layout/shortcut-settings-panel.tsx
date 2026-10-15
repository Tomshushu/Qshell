import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Keyboard,
  RotateCcw,
  Search,
  Check,
  AlertTriangle,
  X,
  Sparkles,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { SHORTCUT_DEFINITIONS, type ShortcutDefinition, type ShortcutScope } from '@/types/shortcuts'
import { useShortcutStore } from '@/store/shortcut-store'
import { eventToAccelerator, isMacPlatform } from '@/utils/shortcut-matcher'

const SCOPE_BADGE_CLASS: Record<ShortcutScope, string> = {
  global: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  terminal: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  sftp: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  dashboard: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
}

export function ShortcutSettingsPanel() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const isMac = useMemo(() => isMacPlatform(), [])

  const customBindings = useShortcutStore((s) => s.customBindings)
  const getBinding = useShortcutStore((s) => s.getBinding)
  const getDisplayKeys = useShortcutStore((s) => s.getDisplayKeys)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const resetAll = useShortcutStore((s) => s.resetAll)

  // 状态：当前正在录制的动作 ID
  const [recordingId, setRecordingId] = useState<string | null>(null)
  // 搜索关键字
  const [searchQuery, setSearchQuery] = useState('')
  // 作用域筛选
  const [selectedScope, setSelectedScope] = useState<ShortcutScope | 'all'>('all')
  // 全部恢复默认二次确认弹窗
  const [showResetAllConfirm, setShowResetAllConfirm] = useState(false)

  // 录制键盘事件监听器
  useEffect(() => {
    if (!recordingId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // 按 Esc 退出录制
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }

      // 按 Backspace 清空（若非受保护按键）
      if (e.key === 'Backspace') {
        const def = SHORTCUT_DEFINITIONS.find((d) => d.id === recordingId)
        if (def?.isProtected) {
          toast.warning(t('shortcut_protected_notice') || '该快捷键受系统保护，不可完全清空')
          return
        }
        setBinding(recordingId, '')
        setRecordingId(null)
        toast.info(t('shortcut_cleared') || '快捷键已清空')
        return
      }

      // 实时计算组合键
      const accelerator = eventToAccelerator(e, isMac)
      // 若仅按下修饰键（Ctrl/Alt/Shift），等待按下主键
      if (!accelerator) return

      // 执行设置并检测冲突
      const result = setBinding(recordingId, accelerator)
      setRecordingId(null)

      if (result.conflictActionId) {
        const conflictDef = SHORTCUT_DEFINITIONS.find((d) => d.id === result.conflictActionId)
        const conflictTitle = conflictDef ? t(conflictDef.titleKey) : result.conflictActionId
        toast.warning(`${t('shortcut_conflict_warning')} (${conflictTitle})`)
      } else {
        toast.success(t('msg_save_success') || '快捷键已更新')
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recordingId, isMac, setBinding, t, toast])

  // 筛选后的列表
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return SHORTCUT_DEFINITIONS.filter((def) => {
      // 作用域过滤
      if (selectedScope !== 'all' && def.scope !== selectedScope) {
        return false
      }
      // 关键字搜索
      if (q) {
        const title = t(def.titleKey).toLowerCase()
        const desc = t(def.descKey).toLowerCase()
        const binding = getBinding(def.id).toLowerCase()
        return title.includes(q) || desc.includes(q) || binding.includes(q)
      }
      return true
    })
  }, [searchQuery, selectedScope, getBinding, t])

  // 按分类分组
  const groupedDefinitions = useMemo(() => {
    const groups: Record<ShortcutScope, ShortcutDefinition[]> = {
      global: [],
      terminal: [],
      sftp: [],
      dashboard: [],
    }
    for (const def of filteredList) {
      groups[def.scope].push(def)
    }
    return groups
  }, [filteredList])

  const scopeLabels: Record<ShortcutScope, string> = {
    global: t('shortcut_scope_global'),
    terminal: t('shortcut_scope_terminal'),
    sftp: t('shortcut_scope_sftp'),
    dashboard: t('shortcut_scope_dashboard'),
  }

  const customizedCount = Object.keys(customBindings).length

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 select-none pb-6">
      {/* 顶部工具栏：搜索、筛选与重置 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('shortcut_search_placeholder')}
            className="h-8 pl-8 text-xs bg-background"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 作用域筛选 Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'global', 'terminal', 'sftp', 'dashboard'] as const).map((sc) => (
            <button
              key={sc}
              onClick={() => setSelectedScope(sc)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors shrink-0',
                selectedScope === sc
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {sc === 'all' ? t('shortcut_filter_all') : scopeLabels[sc]}
            </button>
          ))}
        </div>

        {/* 恢复全部默认 */}
        {customizedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowResetAllConfirm(true)}
            className="h-8 text-xs shrink-0 text-muted-foreground hover:text-foreground gap-1.5"
          >
            <RotateCcw className="h-3 w-3" />
            {t('shortcut_reset_all')}
            <span className="px-1.5 py-0.2 bg-primary/10 text-primary rounded-full text-[10px]">
              {customizedCount}
            </span>
          </Button>
        )}
      </div>

      {/* 提示 Banner */}
      <div className="px-3.5 py-2.5 rounded-lg border bg-muted/20 text-xs text-muted-foreground/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>
            {isMac
              ? '点击快捷键徽章即可录入新按键；Cmd 对应 ⌘，Ctrl 对应 ⌃。'
              : '点击快捷键徽章即可通过键盘录入自定义新按键；终端中断键（如 Ctrl+C）受原生保护。'}
          </span>
        </div>
      </div>

      {/* 分类渲染 */}
      {(['global', 'terminal', 'sftp', 'dashboard'] as const).map((scopeKey) => {
        const items = groupedDefinitions[scopeKey]
        if (items.length === 0) return null

        return (
          <Card
            key={scopeKey}
            className="border/50 bg-background shadow-sm rounded-lg overflow-hidden"
          >
            <div className="px-5 py-2.5 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">{scopeLabels[scopeKey]}</span>
                <span className="text-[10px] text-muted-foreground/60">
                  {items.length} 项
                </span>
              </div>
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded border text-[9px] font-bold',
                  SCOPE_BADGE_CLASS[scopeKey],
                )}
              >
                {scopeLabels[scopeKey]}
              </span>
            </div>

            <div className="p-2 divide-y divide-border/30">
              {items.map((item) => {
                const isRecording = recordingId === item.id
                const isCustom = Boolean(customBindings[item.id])
                const displayKeys = getDisplayKeys(item.id)

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center justify-between gap-4 px-3 py-2 text-xs rounded-md transition-colors',
                      isRecording ? 'bg-primary/5 ring-1 ring-primary/40' : 'hover:bg-muted/30',
                    )}
                  >
                    {/* 左侧说明 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">
                          {t(item.titleKey)}
                        </span>
                        {isCustom && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-500 text-[9px] font-semibold">
                            {t('shortcut_customized')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {t(item.descKey)}
                      </p>
                    </div>

                    {/* 右侧按键录制按钮与重置 */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isRecording ? (
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-mono animate-pulse shadow-sm">
                          <span>{t('shortcut_recording_press')}</span>
                          <span className="text-[10px] opacity-75">
                            ({t('shortcut_recording_cancel')})
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setRecordingId(item.id)}
                          className={cn(
                            'group flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-mono transition-all',
                            isCustom
                              ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/60'
                              : 'bg-muted/40 border-border/70 hover:border-primary/50 hover:bg-muted/70',
                          )}
                          title="点击录入新快捷键"
                        >
                          {displayKeys.length > 0 ? (
                            displayKeys.map((k, idx) => (
                              <React.Fragment key={idx}>
                                {idx > 0 && (
                                  <span className="text-muted-foreground/50 text-[10px]">
                                    +
                                  </span>
                                )}
                                <kbd className="px-1.5 py-0.5 rounded border bg-background font-semibold text-[10px] min-w-[18px] text-center shadow-xs">
                                  {k}
                                </kbd>
                              </React.Fragment>
                            ))
                          ) : (
                            <span className="text-muted-foreground/50 italic text-[11px]">
                              未绑定
                            </span>
                          )}
                        </button>
                      )}

                      {/* 重置单个按键 */}
                      {isCustom && !isRecording && (
                        <button
                          type="button"
                          onClick={() => resetBinding(item.id)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title={t('shortcut_reset_item')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}

      {/* 无匹配提示 */}
      {filteredList.length === 0 && (
        <div className="py-12 text-center text-xs text-muted-foreground">
          未找到匹配的快捷键动作
        </div>
      )}

      {/* 恢复全部默认确认弹窗 */}
      <ConfirmDialog
        open={showResetAllConfirm}
        onOpenChange={setShowResetAllConfirm}
        title={t('shortcut_reset_all_confirm_title')}
        description={t('shortcut_reset_all_confirm_desc')}
        onConfirm={() => {
          resetAll()
          toast.success(t('msg_save_success') || '已恢复所有默认快捷键')
        }}
      />
    </div>
  )
}
