import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag, Pencil, Trash2, ChevronDown, Check, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { sshService } from '@/services/ssh-service'

interface TagFilterPopoverProps {
  allTags: string[]
  tagFilter: string | null
  onSelectTag: (tag: string | null) => void
}

/**
 * 标签筛选下拉：替代原生 <select>，在每项 hover 时提供「编辑 / 删除」按钮，
 * 顶部提供「新建标签」入口。标签来自独立目录（不依赖服务器），因此空标签也会常驻。
 * 重命名 / 删除走后端 tags_* 命令并级联更新所有服务器，再同步前端 store。
 */
export function TagFilterPopover({ allTags, tagFilter, onSelectTag }: TagFilterPopoverProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const servers = useAppStore((s) => s.servers)
  const addTag = useAppStore((s) => s.addTag)
  const renameTag = useAppStore((s) => s.renameTag)
  const deleteTag = useAppStore((s) => s.deleteTag)
  const uiStyle = useAppStore((s) => s.uiStyle)
  const isAnime = uiStyle === 'anime'

  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  // 点击外部关闭下拉（面板已 Portal 到 body，需同时排除按钮与面板内部的点击）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node
      if (wrapRef.current?.contains(node)) return
      if (panelRef.current?.contains(node)) return
      setOpen(false)
      setCreating(false)
      setNewValue('')
    }
    // 用 pointerdown 而非 mousedown：Radix 下拉（如排序菜单）的 trigger 会在
    // pointerdown 上 preventDefault()，导致后续 mousedown 不派发、外点关闭失效
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // 面板 Portal 到 body 后用 fixed 定位：按触发按钮实时对齐
  // （嵌在页面容器内的 absolute 元素会导致 backdrop-filter 毛玻璃失效）
  useEffect(() => {
    if (!open) return
    const update = () => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 208 - 8))
      setPos({ left, top: rect.bottom + 4 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // 标签 -> 使用它的服务器数量（用于列表右侧计数）
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of servers) {
      for (const tag of s.tags || []) {
        map.set(tag, (map.get(tag) || 0) + 1)
      }
    }
    return map
  }, [servers])

  const startRename = (tag: string) => {
    setEditingTag(tag)
    setEditingValue(tag)
  }

  const commitRename = async () => {
    const oldName = editingTag
    if (!oldName) return
    const newName = editingValue.trim()
    if (!newName || newName === oldName) {
      setEditingTag(null)
      setEditingValue('')
      return
    }
    try {
      await sshService.renameTag(oldName, newName)
      renameTag(oldName, newName)
      toast.success(t('tag_renamed', { old: oldName, new: newName }))
    } catch (e) {
      toast.error((e as Error).message || t('tag_rename_failed'))
    }
    setEditingTag(null)
    setEditingValue('')
  }

  const cancelRename = () => {
    setEditingTag(null)
    setEditingValue('')
  }

  const handleDelete = async () => {
    const name = deleteTarget
    if (!name) return
    try {
      await sshService.deleteTag(name)
      deleteTag(name)
      if (tagFilter === name) onSelectTag(null)
      toast.success(t('tag_deleted', { name }))
    } catch (e) {
      toast.error((e as Error).message || t('tag_delete_failed'))
    }
    setDeleteTarget(null)
    setOpen(false)
  }

  const commitCreate = async () => {
    const name = newValue.trim()
    if (!name) {
      setCreating(false)
      setNewValue('')
      return
    }
    if (name.length > 32) {
      toast.error(t('tag_name_too_long'))
      return
    }
    try {
      const created = await sshService.createTag(name)
      addTag(created)
      setCreating(false)
      setNewValue('')
      toast.success(t('tag_created', { name: created }))
    } catch (e) {
      toast.error((e as Error).message || t('tag_create_failed'))
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 min-w-[112px] flex items-center justify-between gap-1.5 rounded-lg border pl-2.5 pr-7 text-xs font-medium outline-none transition-colors cursor-pointer relative',
          isAnime
            ? tagFilter
              ? 'border-pink-400 bg-pink-100/60 text-pink-700 shadow-[0_2px_8px_rgba(255,107,161,0.18)]'
              : 'border-pink-300/60 bg-pink-50/40 text-pink-600 hover:bg-pink-100/60'
            : tagFilter
              ? 'border-primary/40 text-primary bg-primary/5'
              : 'border-border/50 text-muted-foreground bg-muted/30 hover:bg-accent/60',
        )}
        aria-label={t('dashboard_filter_tags')}
      >
        <span className="truncate">{tagFilter || t('dashboard_filter_tags')}</span>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{ left: pos.left, top: pos.top }}
          className={cn(
            'fixed z-[100] w-52 rounded-lg border border-border/60 glass-strong shadow-md p-1.5 space-y-0.5',
            isAnime && 'border-pink-300/60 shadow-[0_8px_28px_rgba(255,107,161,0.18)]',
          )}
        >
          {/* 顶部：全部标签（与「连接目标」下拉顶部选项一致）+ 新建标签 */}
          {creating ? (
            <div className="flex items-center gap-1.5 px-2 h-8">
              <Tag className={cn('h-3 w-3 flex-shrink-0', isAnime ? 'text-pink-500' : 'text-primary')} />
              <Input
                autoFocus
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitCreate()
                  if (e.key === 'Escape') {
                    setCreating(false)
                    setNewValue('')
                  }
                }}
                className="h-6 text-xs flex-1"
                placeholder={t('tag_new_placeholder')}
              />
            </div>
          ) : (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => {
                  onSelectTag(null)
                  setOpen(false)
                }}
                className={cn(
                  'flex-1 flex items-center justify-between gap-1.5 rounded-md px-2 h-8 text-xs transition-colors',
                  tagFilter === null
                    ? (isAnime ? 'bg-pink-100/70 text-pink-700 font-semibold' : 'bg-primary/10 text-primary font-semibold')
                    : (isAnime ? 'text-foreground hover:bg-pink-100/40' : 'text-foreground hover:bg-accent/40'),
                )}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Tag className={cn('h-3 w-3 flex-shrink-0', isAnime ? 'text-pink-500' : 'text-primary')} />
                  <span className="font-medium truncate">{t('dashboard_filter_tags')}</span>
                </span>
                {tagFilter === null && <Check className={cn('h-3.5 w-3.5 flex-shrink-0', isAnime ? 'text-pink-500' : 'text-primary')} />}
              </button>
              <button
                type="button"
                title={t('tag_create_title')}
                onClick={() => {
                  setCreating(true)
                  setNewValue('')
                }}
                className={cn(
                  'h-8 w-8 flex-shrink-0 flex items-center justify-center rounded-md transition-colors',
                  isAnime ? 'text-pink-500 hover:bg-pink-100/40' : 'text-primary hover:bg-accent/40',
                )}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* 标签列表：高度固定，超出部分内部滚动 */}
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {allTags.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t('tag_empty')}
              </div>
            ) : (
              allTags.map((tag) => {
                const isEditing = editingTag === tag
                const isSel = tagFilter === tag
                const count = tagCounts.get(tag) || 0
                return (
                  <div
                    key={tag}
                    className={cn(
                      'group flex items-center gap-1.5 rounded-md px-2 h-8 transition-colors',
                      isEditing
                        ? (isAnime ? 'bg-pink-100/50' : 'bg-accent/40')
                        : isSel
                          ? (isAnime ? 'bg-pink-100/70 text-pink-700' : 'bg-primary/10 text-primary')
                          : (isAnime ? 'hover:bg-pink-100/40' : 'hover:bg-accent/40'),
                    )}
                  >
                    {isEditing ? (
                      <Input
                        ref={(el) => {
                          if (el) {
                            setTimeout(() => {
                              el.focus()
                              el.select()
                            }, 0)
                          }
                        }}
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename()
                          if (e.key === 'Escape') cancelRename()
                        }}
                        className="h-6 text-xs flex-1"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectTag(tag)
                            setOpen(false)
                          }}
                          className="flex-1 flex items-center gap-1.5 min-w-0 text-left"
                        >
                          <Tag className={cn('h-3 w-3 flex-shrink-0', isAnime ? 'text-pink-500' : isSel ? '' : 'text-primary')} />
                          <span className="text-xs font-medium truncate">{tag}</span>
                          <span className="text-[10px] text-muted-foreground/70 tabular-nums">{count}</span>
                          {isSel && <Check className={cn('h-3.5 w-3.5 flex-shrink-0 ml-auto', isAnime ? 'text-pink-500' : 'text-primary')} />}
                        </button>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                          <button
                            type="button"
                            title={t('tag_edit_title')}
                            onClick={() => startRename(tag)}
                            className={cn(
                              'h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors',
                              isAnime ? 'hover:bg-pink-100/60' : 'hover:bg-accent',
                            )}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title={t('tag_delete_title')}
                            onClick={() => {
                              setDeleteTarget(tag)
                              setOpen(false)
                            }}
                            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>,
        document.body,
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('tag_delete_title')}
        description={t('tag_delete_desc', {
          name: deleteTarget ?? '',
          count: tagCounts.get(deleteTarget ?? '') || 0,
        })}
        confirmLabel={t('tag_delete_confirm')}
        cancelLabel={t('tag_delete_cancel')}
        variant="destructive"
        widthClass="max-w-[320px]"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
