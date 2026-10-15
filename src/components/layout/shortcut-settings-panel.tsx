import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Keyboard,
  RotateCcw,
  Search,
  Check,
  AlertTriangle,
  X,
  Sparkles,
  CheckCircle2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { SHORTCUT_DEFINITIONS, type ShortcutDefinition, type ShortcutScope } from '@/types/shortcuts'
import { useShortcutStore } from '@/store/shortcut-store'
import {
  eventToAccelerator,
  acceleratorToDisplayKeys,
  isMacPlatform,
  getPressedModifiers,
} from '@/utils/shortcut-matcher'

const SCOPE_BADGE_CLASS: Record<ShortcutScope, string> = {
  global: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  terminal: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  sftp: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  dashboard: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
}

interface ShortcutRecordModalProps {
  definition: ShortcutDefinition | null
  open: boolean
  onClose: () => void
}

/**
 * 独立键盘录制弹窗 (Keyboard Capture Modal)
 */
function ShortcutRecordModal({ definition, open, onClose }: ShortcutRecordModalProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const isMac = useMemo(() => isMacPlatform(), [])

  const customBindings = useShortcutStore((s) => s.customBindings)
  const getBinding = useShortcutStore((s) => s.getBinding)
  const setBinding = useShortcutStore((s) => s.setBinding)
  const resetBinding = useShortcutStore((s) => s.resetBinding)
  const findConflict = useShortcutStore((s) => s.findConflict)

  // 临时录制状态：待保存的加速键
  const [pendingKey, setPendingKey] = useState<string>('')
  // 当前按住中的修饰键（实时感知）
  const [holdingModifiers, setHoldingModifiers] = useState<string[]>([])

  const isCustom = Boolean(definition && customBindings[definition.id])

  // 打开弹窗时初始化为当前绑定值
  useEffect(() => {
    if (open && definition) {
      setPendingKey(getBinding(definition.id))
      setHoldingModifiers([])
    }
  }, [open, definition, getBinding])

  // 冲突检测
  const conflictDef = useMemo(() => {
    if (!definition || !pendingKey) return undefined
    return findConflict(definition.id, pendingKey)
  }, [definition, pendingKey, findConflict])

  // 录制键盘事件捕获
  useEffect(() => {
    if (!open || !definition) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // 按 Esc 退出
      if (e.key === 'Escape') {
        onClose()
        return
      }

      // 按 Enter 保存
      if (e.key === 'Enter') {
        handleSave()
        return
      }

      // 实时感知按下的修饰键
      const pressedMods = getPressedModifiers(e, isMac)
      const accelerator = eventToAccelerator(e, isMac)

      if (accelerator) {
        setPendingKey(accelerator)
        setHoldingModifiers([])
      } else {
        setHoldingModifiers(pressedMods)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const pressedMods = getPressedModifiers(e, isMac)
      setHoldingModifiers(pressedMods)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [open, definition, pendingKey, isMac, onClose, t, toast])

  const handleSave = () => {
    if (!definition) return

    if (!pendingKey) {
      onClose()
      return
    }

    const result = setBinding(definition.id, pendingKey)
    if (result.conflictActionId) {
      const other = SHORTCUT_DEFINITIONS.find((d) => d.id === result.conflictActionId)
      const otherName = other ? t(other.titleKey) : result.conflictActionId
      toast.warning(`${t('shortcut_conflict_warning')} (${otherName})`)
    } else {
      toast.success(t('msg_save_success') || '快捷键已更新')
    }
    onClose()
  }

  if (!definition) return null

  const displayKeys = acceleratorToDisplayKeys(pendingKey, isMac)

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-w-md w-full p-0 gap-0 overflow-hidden border shadow-2xl bg-card">
        {/* 顶部标题栏 */}
        <DialogHeader className="p-5 pb-3 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold">
                {t('shortcut_record_title')}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                {t('shortcut_record_for_action')}：
                <span className="font-medium text-foreground"> {t(definition.titleKey)}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 核心录制交互区 (高质感录制盒) */}
        <div className="p-5 space-y-4">
          <div className="text-center space-y-2">
            <div
              className={cn(
                'min-h-[96px] w-full rounded-xl border-2 border-dashed flex flex-col items-center justify-center p-4 transition-all duration-200 select-none',
                holdingModifiers.length > 0
                  ? 'border-primary bg-primary/5 ring-4 ring-primary/10'
                  : pendingKey
                    ? 'border-primary/40 bg-muted/30'
                    : 'border-muted-foreground/30 bg-muted/10',
              )}
            >
              {holdingModifiers.length > 0 ? (
                // 实时按住态感知展示
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {holdingModifiers.map((mod, i) => (
                    <React.Fragment key={i}>
                      <kbd className="min-w-[40px] h-9 px-3 rounded-lg border bg-background font-mono font-bold text-xs flex items-center justify-center shadow-xs text-primary border-primary/40">
                        {mod}
                      </kbd>
                      <span className="text-muted-foreground/60 text-xs font-bold">+</span>
                    </React.Fragment>
                  ))}
                  <span className="text-xs text-muted-foreground font-medium animate-pulse flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                    {t('shortcut_record_waiting_key')}
                  </span>
                </div>
              ) : displayKeys.length > 0 ? (
                // 已录制的按键呈现
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {displayKeys.map((k, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && (
                        <span className="text-muted-foreground/60 text-sm font-bold">+</span>
                      )}
                      <kbd className="min-w-[44px] h-10 px-3.5 rounded-lg border border-border/80 bg-background font-mono font-bold text-sm flex items-center justify-center shadow-sm text-foreground">
                        {k}
                      </kbd>
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <div className="text-xs text-muted-foreground font-medium">
                    {t('shortcut_record_unassigned')}
                  </div>
                  <div className="text-[11px] text-muted-foreground/60">
                    {t('shortcut_record_press_hint')}
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground/70">
              {t('shortcut_record_subtitle')}
            </p>
          </div>

          {/* 实时冲突与可用性状态条 */}
          {conflictDef ? (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-medium">
                  {t('shortcut_record_conflict_with')}{' '}
                  <span className="font-bold underline">{t(conflictDef.titleKey)}</span>
                </div>
                <div className="text-[11px] opacity-80">
                  {t('shortcut_record_conflict_notice')}
                </div>
              </div>
            </div>
          ) : pendingKey ? (
            <div className="p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{t('shortcut_record_no_conflict')}</span>
            </div>
          ) : null}
        </div>

        {/* 底部操作工具栏 */}
        <DialogFooter className="p-4 border-t bg-muted/20 flex flex-row items-center justify-between gap-2 sm:justify-between">
          <div>
            {isCustom && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetBinding(definition.id)
                  toast.success(t('msg_save_success') || '已恢复默认')
                  onClose()
                }}
                className="text-xs text-muted-foreground hover:text-foreground h-8 gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t('shortcut_reset_item')}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-8"
            >
              {t('shortcut_record_cancel_btn')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              className="text-xs h-8 gap-1.5 shadow-sm"
            >
              <Check className="h-3.5 w-3.5" />
              {t('shortcut_record_save_btn')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ShortcutSettingsPanel() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const isMac = useMemo(() => isMacPlatform(), [])

  const customBindings = useShortcutStore((s) => s.customBindings)
  const getBinding = useShortcutStore((s) => s.getBinding)
  const getDisplayKeys = useShortcutStore((s) => s.getDisplayKeys)
  const resetAll = useShortcutStore((s) => s.resetAll)

  // 状态：正在录制的动作定义（点击行触发 Record Modal）
  const [activeDef, setActiveDef] = useState<ShortcutDefinition | null>(null)
  // 搜索关键字
  const [searchQuery, setSearchQuery] = useState('')
  // 作用域筛选
  const [selectedScope, setSelectedScope] = useState<ShortcutScope | 'all' | 'customized'>('all')
  // 全部恢复默认二次确认弹窗
  const [showResetAllConfirm, setShowResetAllConfirm] = useState(false)
  // 按键反查搜索模式
  const [isKeySearching, setIsKeySearching] = useState(false)

  // 快捷键反查捕获
  useEffect(() => {
    if (!isKeySearching) return

    const handleKeySearch = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setIsKeySearching(false)
        return
      }

      const accelerator = eventToAccelerator(e, isMac)
      if (accelerator) {
        setSearchQuery(accelerator)
        setIsKeySearching(false)
      }
    }

    window.addEventListener('keydown', handleKeySearch, true)
    return () => window.removeEventListener('keydown', handleKeySearch, true)
  }, [isKeySearching, isMac])

  // 筛选后的列表
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return SHORTCUT_DEFINITIONS.filter((def) => {
      // 作用域 / 已自定义过滤
      if (selectedScope === 'customized') {
        if (!Boolean(customBindings[def.id])) return false
      } else if (selectedScope !== 'all' && def.scope !== selectedScope) {
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
  }, [searchQuery, selectedScope, customBindings, getBinding, t])

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
      {/* 顶部工具栏：搜索、按键反查、筛选与批量重置 */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isKeySearching
                  ? '请在键盘上按下快捷键组合...'
                  : t('shortcut_search_placeholder')
              }
              className={cn(
                'h-8 pl-8 pr-16 text-xs bg-background transition-colors',
                isKeySearching && 'border-primary ring-2 ring-primary/20 bg-primary/5',
              )}
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {/* 按快捷键反查按钮 */}
              <button
                type="button"
                onClick={() => setIsKeySearching(!isKeySearching)}
                title={t('shortcut_search_by_key')}
                className={cn(
                  'p-1 rounded border text-xs transition-colors',
                  isKeySearching
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/60',
                )}
              >
                <Keyboard className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* 作用域筛选 Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedScope('all')}
            className={cn(
              'px-2.5 py-1 rounded-md text-xs transition-colors shrink-0',
              selectedScope === 'all'
                ? 'bg-primary text-primary-foreground font-medium shadow-xs'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t('shortcut_filter_all')}
          </button>

          {customizedCount > 0 && (
            <button
              onClick={() => setSelectedScope('customized')}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors shrink-0 flex items-center gap-1.5',
                selectedScope === 'customized'
                  ? 'bg-amber-500 text-white font-medium shadow-xs'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
              )}
            >
              <span>{t('shortcut_filter_customized')}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-bold">
                {customizedCount}
              </span>
            </button>
          )}

          {(['global', 'terminal', 'sftp', 'dashboard'] as const).map((sc) => (
            <button
              key={sc}
              onClick={() => setSelectedScope(sc)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs transition-colors shrink-0',
                selectedScope === sc
                  ? 'bg-primary text-primary-foreground font-medium shadow-xs'
                  : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {scopeLabels[sc]}
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
      <div className="px-3.5 py-2 rounded-lg border bg-muted/20 text-xs text-muted-foreground/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>
            {isMac
              ? '鼠标点击任意一行即可录制新按键；Cmd 对应 ⌘，Ctrl 对应 ⌃。'
              : '鼠标点击任意一行即可录制新按键；支持实时冲突感知与一键重置。'}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground/60 hidden sm:block">
          共 {filteredList.length} 项快捷操作
        </div>
      </div>

      {/* 分类分组渲染 */}
      {(['global', 'terminal', 'sftp', 'dashboard'] as const).map((scopeKey) => {
        const items = groupedDefinitions[scopeKey]
        if (items.length === 0) return null

        return (
          <Card
            key={scopeKey}
            className="border/50 bg-background shadow-xs rounded-xl overflow-hidden"
          >
            {/* 分类标题条 */}
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-foreground">
                  {scopeLabels[scopeKey]}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  {items.length} 项
                </span>
              </div>
              <span
                className={cn(
                  'px-2 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider',
                  SCOPE_BADGE_CLASS[scopeKey],
                )}
              >
                {scopeLabels[scopeKey]}
              </span>
            </div>

            {/* 列表项：单次点击整行即可触发录制 */}
            <div className="divide-y divide-border/30">
              {items.map((item) => {
                const isCustom = Boolean(customBindings[item.id])
                const displayKeys = getDisplayKeys(item.id)

                return (
                  <div
                    key={item.id}
                    onClick={() => setActiveDef(item)}
                    className="group flex items-center justify-between gap-4 px-4 py-2.5 text-xs transition-colors hover:bg-muted/50 cursor-pointer"
                  >
                    {/* 左侧说明与元数据 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {t(item.titleKey)}
                        </span>
                        {isCustom && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[9px] font-semibold border border-amber-500/20">
                            {t('shortcut_customized')}
                          </span>
                        )}
                        {item.isProtected && (
                          <span className="px-1.5 py-0.2 rounded bg-muted text-muted-foreground/80 text-[9px] font-medium border">
                            {t('shortcut_protected_badge')}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                        {t(item.descKey)}
                      </p>
                    </div>

                    {/* 右侧按键徽章：纯净展示，跟随整行点击 */}
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-md border text-xs font-mono transition-all bg-muted/40 border-border/70 group-hover:border-primary/50 group-hover:bg-muted/70 shrink-0">
                      {displayKeys.length > 0 ? (
                        displayKeys.map((k, idx) => (
                          <React.Fragment key={idx}>
                            {idx > 0 && (
                              <span className="text-muted-foreground/50 text-[10px] font-bold">
                                +
                              </span>
                            )}
                            <kbd className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded border border-border/80 bg-background font-mono font-semibold text-[10px] shadow-[0_1px_0_0_rgba(0,0,0,0.15)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.08)]">
                              {k}
                            </kbd>
                          </React.Fragment>
                        ))
                      ) : (
                        <span className="text-muted-foreground/40 italic text-[11px] px-1">
                          {t('shortcut_record_unassigned')}
                        </span>
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
        <div className="py-12 text-center text-xs text-muted-foreground space-y-1">
          <div>未找到匹配的快捷键动作</div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-primary hover:underline text-[11px]"
            >
              清除搜索条件
            </button>
          )}
        </div>
      )}

      {/* 录制快捷键独立弹窗 (单机整行唤起) */}
      <ShortcutRecordModal
        definition={activeDef}
        open={Boolean(activeDef)}
        onClose={() => setActiveDef(null)}
      />

      {/* 恢复全部默认确认弹窗 */}
      <ConfirmDialog
        open={showResetAllConfirm}
        onCancel={() => setShowResetAllConfirm(false)}
        title={t('shortcut_reset_all_confirm_title')}
        description={t('shortcut_reset_all_confirm_desc')}
        onConfirm={() => {
          resetAll()
          setShowResetAllConfirm(false)
          toast.success(t('msg_save_success') || '已恢复所有默认快捷键')
        }}
      />
    </div>
  )
}
