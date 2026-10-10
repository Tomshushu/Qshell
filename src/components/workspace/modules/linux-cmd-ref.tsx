import { useState, useMemo, useEffect, useCallback } from 'react'
import { LINUX_CATEGORIES, type LinuxCommand } from '@/data/linux-commands'
import { NETWORK_CATEGORIES } from '@/data/network-commands'
import { sshService } from '@/services/ssh-service'
import { Search, X, ChevronRight, Copy, Check, Plus, Pencil, Trash2, Star, Terminal, Sparkles } from 'lucide-react'
import { useTranslation } from '@/i18n'
import {
  ParameterizedSnippetDialog,
  extractSnippetParams,
} from './parameterized-snippet-dialog'

interface FavCmd {
  id: string
  cmd: string
  desc: string
  createdAt: number
}

interface LinuxCmdRefProps {
  targetType?: string
  onCopyCmd?: () => void
  onInsertCmd?: (cmd: string) => void
}

export function LinuxCmdRef({ targetType, onCopyCmd, onInsertCmd }: LinuxCmdRefProps) {
  const { t } = useTranslation()
  const [paramDialogState, setParamDialogState] = useState<{
    open: boolean
    template: string
    description?: string
  }>({ open: false, template: '' })
  const categories = useMemo(() => {
    if (targetType === 'network') {
      return NETWORK_CATEGORIES as unknown as typeof LINUX_CATEGORIES
    }
    return LINUX_CATEGORIES
  }, [targetType])

  const [activeCat, setActiveCat] = useState(() => categories[0]?.key ?? '')
  const [search, setSearch] = useState('')
  const [expandedCmd, setExpandedCmd] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

  // categories 变化时同步首部分类（渲染期「props 变化时调整 state」）
  const [prevCategories, setPrevCategories] = useState(categories)
  if (categories !== prevCategories) {
    setPrevCategories(categories)
    setActiveCat(categories[0]?.key ?? '')
  }

  // 收藏相关状态
  const [favCmds, setFavCmds] = useState<FavCmd[]>([])
  const [showAddFav, setShowAddFav] = useState(false)
  const [newFavCmd, setNewFavCmd] = useState('')
  const [newFavDesc, setNewFavDesc] = useState('')
  const [editingFav, setEditingFav] = useState<string | null>(null)
  const [editFavCmd, setEditFavCmd] = useState('')
  const [editFavDesc, setEditFavDesc] = useState('')

  // 加载收藏
  const loadFavCmds = useCallback(async () => {
    try {
      const data = await sshService.listFavCmds()
      setFavCmds(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    // 延后到宏任务加载，避免在 effect 内同步 setState 触发级联渲染
    const timer = setTimeout(() => {
      void loadFavCmds()
    }, 0)
    return () => clearTimeout(timer)
  }, [loadFavCmds])

  // 搜索结果（含收藏）
  const filteredResults = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const results: { cat: string; catLabel: string; cmd: LinuxCommand }[] = []
    for (const cat of categories) {
      for (const cmd of cat.commands) {
        if (
          cmd.cmd.toLowerCase().includes(q) ||
          t(cmd.desc).toLowerCase().includes(q) ||
          cmd.example.toLowerCase().includes(q) ||
          t(cmd.params).toLowerCase().includes(q)
        ) {
          results.push({ cat: cat.key, catLabel: t(cat.label), cmd })
        }
      }
    }
    // 也搜索收藏
    for (const fav of favCmds) {
      if (fav.cmd.toLowerCase().includes(q) || fav.desc.toLowerCase().includes(q)) {
        results.push({
          cat: 'fav',
          catLabel: t('lcr_favorites'),
          cmd: { cmd: fav.cmd, example: fav.cmd, desc: fav.desc, params: '' },
        })
      }
    }
    return results
  }, [search, favCmds, categories, t])

  const currentCat = categories.find(c => c.key === activeCat)

  const handleCopy = (text: string) => {
    try {
      navigator.clipboard.writeText(text)
    } catch { /* clipboard API 可能不可用 */ }
    setCopiedCmd(text)
    onCopyCmd?.()
    setTimeout(() => setCopiedCmd(null), 1500)
  }

  const handleExecuteOrCopy = (text: string, desc?: string) => {
    const params = extractSnippetParams(text)
    if (params.length > 0) {
      setParamDialogState({
        open: true,
        template: text,
        description: desc,
      })
      return
    }
    if (onInsertCmd) {
      onInsertCmd(text)
    } else {
      handleCopy(text)
    }
  }

  const handleParamConfirm = (interpolated: string, action: 'copy' | 'insert') => {
    if (action === 'insert' && onInsertCmd) {
      onInsertCmd(interpolated)
    } else {
      handleCopy(interpolated)
    }
  }

  const handleAddFav = async () => {
    if (!newFavCmd.trim()) return
    await sshService.addFavCmd(newFavCmd.trim(), newFavDesc.trim())
    setNewFavCmd('')
    setNewFavDesc('')
    setShowAddFav(false)
    loadFavCmds()
  }

  const handleUpdateFav = async (id: string) => {
    if (!editFavCmd.trim()) return
    await sshService.updateFavCmd(id, editFavCmd.trim(), editFavDesc.trim())
    setEditingFav(null)
    loadFavCmds()
  }

  const handleDeleteFav = async (id: string) => {
    await sshService.deleteFavCmd(id)
    loadFavCmds()
  }

  const startEditFav = (fav: FavCmd) => {
    setEditingFav(fav.id)
    setEditFavCmd(fav.cmd)
    setEditFavDesc(fav.desc)
  }

  const renderCommandRow = (cmd: LinuxCommand, catLabel?: string) => {
    const hasParams = extractSnippetParams(cmd.example).length > 0;
    return (
      <div key={cmd.cmd + catLabel} className="border-b border-border/30 last:border-b-0">
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors">
          <code
            className="text-[11px] font-mono text-emerald-400 shrink-0 cursor-pointer hover:text-emerald-300 min-w-[180px] flex items-center gap-1.5"
            onClick={() => handleExecuteOrCopy(cmd.example, t(cmd.desc))}
            title={t('lcr_click_copy')}
          >
            <span>{cmd.example}</span>
            {hasParams && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-primary/10 text-primary border border-primary/20" title={t('lcr_param_hint')}>
                <Sparkles className="h-2.5 w-2.5" />
                {t('lcr_param_hint')}
              </span>
            )}
          </code>
          <span className="text-[11px] text-muted-foreground flex-1 truncate">
            {catLabel && <span className="text-blue-400/70 mr-1">[{catLabel}]</span>}
            {t(cmd.desc)}
          </span>
          {cmd.params && (
            <button
              className={`shrink-0 flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded transition-colors ${
                expandedCmd === cmd.cmd
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => setExpandedCmd(expandedCmd === cmd.cmd ? null : cmd.cmd)}
            >
              {t('lcr_params')}
              <ChevronRight className={`h-2.5 w-2.5 transition-transform ${expandedCmd === cmd.cmd ? 'rotate-90' : ''}`} />
            </button>
          )}
          {onInsertCmd && (
            <button
              className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
              onClick={() => handleExecuteOrCopy(cmd.example, t(cmd.desc))}
              title={t('lcr_send_terminal')}
            >
              <Terminal className="h-3 w-3" />
            </button>
          )}
          <button
            className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handleExecuteOrCopy(cmd.example, t(cmd.desc))}
            title={t('lcr_copy_example')}
          >
            {copiedCmd === cmd.example ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
        {expandedCmd === cmd.cmd && cmd.params && (
          <div className="px-3 pb-2 pl-[200px]">
            <div className="bg-muted/30 rounded px-3 py-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed border border-border/20">
              {t(cmd.params)}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFavRow = (fav: FavCmd) => {
    if (editingFav === fav.id) {
      return (
        <div key={fav.id} className="border-b border-border/30 px-3 py-2 space-y-1.5 bg-accent/20">
          <input
            className="w-full bg-muted/50 rounded px-2 py-1 text-[11px] font-mono outline-none border border-border/50 focus:border-primary/50"
            value={editFavCmd}
            onChange={e => setEditFavCmd(e.target.value)}
            autoFocus
            placeholder={t('lcr_cmd_placeholder')}
            onKeyDown={e => { if (e.key === 'Enter') handleUpdateFav(fav.id); if (e.key === 'Escape') setEditingFav(null) }}
          />
          <input
            className="w-full bg-muted/50 rounded px-2 py-1 text-[11px] outline-none border border-border/50 focus:border-primary/50"
            value={editFavDesc}
            onChange={e => setEditFavDesc(e.target.value)}
            placeholder={t('lcr_desc_placeholder')}
            onKeyDown={e => { if (e.key === 'Enter') handleUpdateFav(fav.id); if (e.key === 'Escape') setEditingFav(null) }}
          />
          <div className="flex gap-1.5">
            <button onClick={() => handleUpdateFav(fav.id)} disabled={!editFavCmd.trim()} className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-40">{t('lcr_save')}</button>
            <button onClick={() => setEditingFav(null)} className="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:bg-accent">{t('lcr_cancel')}</button>
          </div>
        </div>
      )
    }
    const hasParams = extractSnippetParams(fav.cmd).length > 0;
    return (
      <div key={fav.id} className="border-b border-border/30 last:border-b-0">
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors group">
          <code
            className="text-[11px] font-mono text-amber-400 shrink-0 cursor-pointer hover:text-amber-300 min-w-[180px] flex items-center gap-1.5"
            onClick={() => handleExecuteOrCopy(fav.cmd, fav.desc)}
            title={t('lcr_click_copy')}
          >
            <span>{fav.cmd}</span>
            {hasParams && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-primary/10 text-primary border border-primary/20" title={t('lcr_param_hint')}>
                <Sparkles className="h-2.5 w-2.5" />
                {t('lcr_param_hint')}
              </span>
            )}
          </code>
          <span className="text-[11px] text-muted-foreground flex-1 truncate">{fav.desc}</span>
          <button
            className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            onClick={() => startEditFav(fav)}
            title={t('lcr_edit')}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            onClick={() => handleDeleteFav(fav.id)}
            title={t('lcr_delete')}
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {onInsertCmd && (
            <button
              className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
              onClick={() => handleExecuteOrCopy(fav.cmd, fav.desc)}
              title={t('lcr_send_terminal')}
            >
              <Terminal className="h-3 w-3" />
            </button>
          )}
          <button
            className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handleExecuteOrCopy(fav.cmd, fav.desc)}
            title={t('lcr_copy')}
          >
            {copiedCmd === fav.cmd ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
    )
  }

  const totalCount = categories.reduce((s, c) => s + c.commands.length, 0) + favCmds.length

  return (
    <div className="flex h-full">
      {/* 左侧分类 */}
      <div className="w-[100px] shrink-0 border-r border-border/40 overflow-y-auto py-1 flex flex-col">
        {categories.map(cat => (
          <button
            key={cat.key}
            onClick={() => { setActiveCat(cat.key); setSearch(''); setExpandedCmd(null) }}
            className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent/50 ${
              activeCat === cat.key && !search ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
            }`}
          >
            {t(cat.label)}
          </button>
        ))}
        <div className="border-t my-1" />
        <button
          onClick={() => { setActiveCat('fav'); setSearch(''); setExpandedCmd(null) }}
          className={`w-full text-left px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent/50 flex items-center gap-1 ${
            activeCat === 'fav' && !search ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
          }`}
        >
          <Star className="h-3 w-3" />
          {t('lcr_favorites')}
          {favCmds.length > 0 && <span className="ml-auto text-[10px] opacity-50">{favCmds.length}</span>}
        </button>
      </div>

      {/* 右侧指令列表 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 搜索栏 */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/40 shrink-0">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" />
          <input
            className="flex-1 bg-transparent border-0 outline-none text-[11px] placeholder:text-muted-foreground/50"
            placeholder={t('lcr_search_placeholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 表头 */}
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border/30 bg-muted/20 shrink-0">
          <span className="text-[10px] text-muted-foreground font-medium min-w-[180px]">{t('lcr_th_cmd')}</span>
          <span className="text-[10px] text-muted-foreground font-medium flex-1">{t('lcr_th_desc')}</span>
          <span className="text-[10px] text-muted-foreground font-medium w-[46px] text-center">{t('lcr_th_action')}</span>
        </div>

        {/* 命令列表 */}
        <div className="overflow-y-auto flex-1">
          {search ? (
            filteredResults && filteredResults.length > 0 ? (
              filteredResults.map(r => renderCommandRow(r.cmd, r.catLabel))
            ) : (
              <div className="text-[11px] text-muted-foreground text-center py-6">{t('lcr_no_match')}</div>
            )
          ) : activeCat === 'fav' ? (
            <>
              {/* 添加收藏按钮 */}
              <div className="px-3 py-1.5 border-b border-border/40">
                {!showAddFav ? (
                  <button onClick={() => setShowAddFav(true)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                    <Plus className="h-3 w-3" /> {t('lcr_add_cmd')}
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      className="w-full bg-muted/50 rounded px-2 py-1 text-[11px] font-mono outline-none border border-border/50 focus:border-primary/50"
                      placeholder={t('lcr_cmd_input')}
                      value={newFavCmd}
                      onChange={e => setNewFavCmd(e.target.value)}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleAddFav(); if (e.key === 'Escape') { setShowAddFav(false); setNewFavCmd(''); setNewFavDesc('') } }}
                    />
                    <input
                      className="w-full bg-muted/50 rounded px-2 py-1 text-[11px] outline-none border border-border/50 focus:border-primary/50"
                      placeholder={t('lcr_desc_input')}
                      value={newFavDesc}
                      onChange={e => setNewFavDesc(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddFav(); if (e.key === 'Escape') { setShowAddFav(false); setNewFavCmd(''); setNewFavDesc('') } }}
                    />
                    <div className="flex gap-1.5">
                      <button onClick={handleAddFav} disabled={!newFavCmd.trim()} className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-40">{t('lcr_add')}</button>
                      <button onClick={() => { setShowAddFav(false); setNewFavCmd(''); setNewFavDesc('') }} className="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:bg-accent">{t('lcr_cancel')}</button>
                    </div>
                  </div>
                )}
              </div>
              {/* 收藏列表 */}
              {favCmds.length === 0 && !showAddFav ? (
                <div className="text-[11px] text-muted-foreground text-center py-6">{t('lcr_empty_fav')}</div>
              ) : (
                favCmds.map(fav => renderFavRow(fav))
              )}
            </>
          ) : (
            currentCat ? currentCat.commands.map(cmd => renderCommandRow(cmd)) : null
          )}
        </div>

        {/* 底部统计 */}
        <div className="px-3 py-1 border-t border-border/30 bg-muted/10 shrink-0">
          <span className="text-[9px] text-muted-foreground/60">
            {search
              ? t('lcr_count_results').replace('{n}', String(filteredResults?.length ?? 0))
              : activeCat === 'fav'
                ? t('lcr_count_favs').replace('{n}', String(favCmds.length))
                : t('lcr_count_cmds').replace('{n}', String(currentCat?.commands.length ?? 0)).replace('{total}', String(totalCount))
            }
          </span>
        </div>
      </div>

      <ParameterizedSnippetDialog
        open={paramDialogState.open}
        onOpenChange={(open) =>
          setParamDialogState((prev) => ({ ...prev, open }))
        }
        template={paramDialogState.template}
        description={paramDialogState.description}
        onConfirm={handleParamConfirm}
        hasInsertTarget={!!onInsertCmd}
      />
    </div>
  )
}
