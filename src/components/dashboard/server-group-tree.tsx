import { useState, useMemo, useCallback, useEffect, memo } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, FolderTree, History, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAppStore } from '@/store'
import { sshService } from '@/services/ssh-service'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import { cn } from '@/lib/utils'
import { SERVER_DRAG_MIME, collectSubtreeIds, buildGroupTree, buildGroupPathMap, HOST_GROUP_ID, type GroupTreeNode } from '@/lib/server-groups'
import { GroupTreePicker } from '@/components/ui/group-tree-picker'
import type { ServerGroup } from '@/types'

/** 行内编辑输入框挂载时强制聚焦：延后到 ContextMenu 关闭后的焦点恢复之后，避免 autoFocus 被顶掉 */
function focusEditingInput(el: HTMLInputElement | null) {
  if (!el) return
  setTimeout(() => {
    el.focus()
    el.select()
  }, 0)
}

type GroupNode = GroupTreeNode

/**
 * 树形层级引导线（VS Code / Figma 风格）：每层一条淡竖线，不画 ├└ 转折。
 * 该层还有后续兄弟时竖线贯穿整行以继续向下连接，
 * 否则只画上半段收尾，避免线头悬空。
 */
function IndentGuides({ guides }: { guides: boolean[] }) {
  return (
    <>
      {guides.map((continues, i) => (
        <span key={i} className="relative w-3.5 flex-shrink-0 self-stretch">
          <span
            className={cn(
              'absolute left-0',
              continues ? 'top-0 h-full' : 'top-0 h-1/2',
            )}
          />
        </span>
      ))}
    </>
  )
}

interface ServerGroupTreeProps {
  selectedGroupId: string | null
  onSelectGroup: (groupId: string | null) => void
  recentServerIds: string[]
  /** 在指定分组下新建服务器（右键分组 → 新建服务器） */
  onAddServerToGroup?: (groupId: string) => void
  /** 回收站待删除服务器数量 */
  trashCount?: number
  /** 打开回收站弹框 */
  onOpenTrash?: () => void
}

/**
 * 左侧服务器分组树（目录结构）。
 *
 * - 点击分组节点 → 右侧内容区过滤显示该分组（含子孙分组）的服务器
 * - 右键 → 新建子分组 / 重命名 / 删除
 * - 服务器卡片（含批量选中）可拖拽到分组节点完成移动
 * - 分组节点之间可拖拽调整层级（后端含环检测）
 */
export const ServerGroupTree = memo(function ServerGroupTree({
  selectedGroupId,
  onSelectGroup,
  recentServerIds,
  onAddServerToGroup,
  trashCount = 0,
  onOpenTrash,
}: ServerGroupTreeProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { servers, serverGroups, addServerGroup, updateServerGroup, deleteServerGroup, updateServer } = useAppStore()

  // 展开状态（默认全部展开；记录的是"被折叠"的分组 ID）
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  // 行内编辑状态：{ mode: 'rename' | 'create', groupId, value }
  const [editing, setEditing] = useState<{ mode: 'rename' | 'create'; groupId: string | null; value: string } | null>(null)
  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<ServerGroup | null>(null)
  // 拖拽悬停高亮
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // 分组树（含每组的后代分组集合，用于服务器计数与过滤）
  const tree = useMemo(() => buildGroupTree(serverGroups), [serverGroups])
  // 分组完整路径映射（如「服务器/公司/内网」），用于移动分组等选择器展示层级归属
  const groupPathMap = useMemo(() => buildGroupPathMap(serverGroups), [serverGroups])

  /** 每个分组的服务器数量（含子孙分组内的服务器） */
  const serverCountByGroup = useMemo(() => {
    const map = new Map<string, number>()
    // groupId → 直接归属的服务器数
    const direct = new Map<string, number>()
    for (const s of servers) {
      if (s.groupId) direct.set(s.groupId, (direct.get(s.groupId) ?? 0) + 1)
    }
    for (const g of serverGroups) {
      const subtree = collectSubtreeIds(serverGroups, g.id)
      let count = 0
      for (const gid of subtree) count += direct.get(gid) ?? 0
      map.set(g.id, count)
    }
    return map
  }, [servers, serverGroups])

  /** 新建分组（parent 为 null 表示根目录） */
  const handleCreate = useCallback(async (parentId: string | null, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (trimmed.length > 50) {
      toast.error('分组名称不能超过 50 个字符')
      return
    }
    try {
      const result = await sshService.addGroup(trimmed, parentId)
      if (!result.success || !result.id) {
        toast.error(`${t('common_op_failed')}: ${result.error ?? ''}`)
        return
      }
      const now = Date.now()
      // 后端对 parentId=null 的分组会归入「服务器」根，前端乐观更新保持一致
      addServerGroup({ id: result.id, name: trimmed, parentId: parentId ?? HOST_GROUP_ID, createdAt: now, updatedAt: now })
      playSound(SoundType.Toggle)
    } catch (e) {
      toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
    }
  }, [addServerGroup, t, toast])

  /** 提交行内编辑（重命名 / 新建） */
  const handleSubmitEdit = useCallback(async () => {
    if (!editing) return
    const { mode, groupId, value } = editing
    setEditing(null)
    if (mode === 'create') {
      await handleCreate(groupId, value)
    } else if (groupId) {
      const trimmed = value.trim()
      if (!trimmed) return
      if (trimmed.length > 50) {
        toast.error('分组名称不能超过 50 个字符')
        return
      }
      try {
        const result = await sshService.updateGroup(groupId, { name: trimmed })
        if (!result.success) {
          toast.error(`${t('common_op_failed')}: ${result.error ?? ''}`)
          return
        }
        updateServerGroup(groupId, { name: trimmed })
        playSound(SoundType.Toggle)
      } catch (e) {
        toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
      }
    }
  }, [editing, handleCreate, updateServerGroup, t, toast])

  /** 确认删除分组 */
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      const result = await sshService.deleteGroup(target.id)
      if (!result.success) {
        toast.error(`${t('common_op_failed')}: ${result.error ?? ''}`)
        return
      }
      // store 内同时把该子树服务器的 groupId 置空
      deleteServerGroup(target.id)
      // 若删除的是当前选中的分组（或其祖先），回退到"全部服务器"
      const subtree = collectSubtreeIds(serverGroups, target.id)
      if (selectedGroupId && subtree.has(selectedGroupId)) {
        onSelectGroup(null)
      }
      playSound(SoundType.Toggle)
    } catch (e) {
      toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
    }
  }, [deleteTarget, deleteServerGroup, serverGroups, selectedGroupId, onSelectGroup, t, toast])

  /** 服务器（批量）拖入分组 */
  const handleDropServers = useCallback(async (e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverGroupId(null)
    try {
      const raw = e.dataTransfer.getData(SERVER_DRAG_MIME)
      if (!raw) return
      const ids = JSON.parse(raw) as string[]
      if (!Array.isArray(ids) || ids.length === 0) return
      const result = await sshService.moveServersToGroup(ids, groupId)
      if (result.failed.length > 0) {
        toast.error(`${t('common_op_failed')}: ${result.failed[0]}`)
      }
      // 同步 store 中服务器的 groupId（成功的那部分）
      for (const id of ids) {
        if (!result.failed.includes(id)) updateServer(id, { groupId })
      }
      playSound(SoundType.Toggle)
    } catch {
      // 非 JSON 负载，忽略
    }
  }, [t, toast, updateServer])

  /** 分组拖入另一个分组（调整层级） */
  const handleDropGroup = useCallback(async (e: React.DragEvent, targetGroupId: string | null, draggedGroupId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverGroupId(null)
    if (draggedGroupId === targetGroupId) return
    try {
      const result = await sshService.updateGroup(draggedGroupId, { parentId: targetGroupId })
      if (!result.success) {
        toast.error(`${t('common_op_failed')}: ${result.error ?? ''}`)
        return
      }
      updateServerGroup(draggedGroupId, { parentId: targetGroupId })
      // 展开目标分组，让用户立刻看到结果
      if (targetGroupId) {
        setCollapsedIds((prev) => {
          const next = new Set(prev)
          next.delete(targetGroupId)
          return next
        })
      }
      playSound(SoundType.Toggle)
    } catch (e2) {
      toast.error(`${t('common_op_failed')}: ${(e2 as Error).message || e2}`)
    }
  }, [updateServerGroup, t, toast])

  /** 分组移动到另一个分组（调整层级），排除自身子孙防环 */
  const handleMoveGroup = useCallback(async (draggedGroupId: string, targetGroupId: string | null) => {
    if (draggedGroupId === targetGroupId) return
    try {
      const result = await sshService.updateGroup(draggedGroupId, { parentId: targetGroupId })
      if (!result.success) {
        toast.error(`${t('common_op_failed')}: ${result.error ?? ''}`)
        return
      }
      updateServerGroup(draggedGroupId, { parentId: targetGroupId })
      if (targetGroupId) {
        setCollapsedIds((prev) => {
          const next = new Set(prev)
          next.delete(targetGroupId)
          return next
        })
      }
      playSound(SoundType.Toggle)
    } catch (e2) {
      toast.error(`${t('common_op_failed')}: ${(e2 as Error).message || e2}`)
    }
  }, [updateServerGroup, t, toast])

  const toggleExpand = useCallback((groupId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  // Enter 提交 / Escape 取消 行内编辑
  useEffect(() => {
    if (!editing) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing])

  /** 递归渲染分组节点 */
  const renderNode = (node: GroupNode): React.ReactNode => {
    const { group, children } = node
    const hasChildren = children.length > 0
    const expanded = !collapsedIds.has(group.id)
    const isSelected = selectedGroupId === group.id
    const count = serverCountByGroup.get(group.id) ?? 0
    const excluded = collectSubtreeIds(serverGroups, group.id)
    const isEditingThis = editing?.mode === 'rename' && editing.groupId === group.id
    const isCreatingChild = editing?.mode === 'create' && editing.groupId === group.id
    const isDragOver = dragOverGroupId === group.id

    // 新建子分组的行内输入框：作为该分组的最后一个子节点，
    // 因此引导线画 └，并把当前节点是否还有后续兄弟计入续接线。
    const createInputRow = isCreatingChild ? (
      <div className="flex items-center gap-1 h-6 pl-1 pr-1.5">
        <IndentGuides guides={[...node.guideLines, !node.isLast]} />
        <span className="w-3.5 flex-shrink-0" />
        <span className="w-3.5 flex-shrink-0" />
        <Input
          value={editing.value}
          ref={focusEditingInput}
          placeholder={t('group_name_placeholder')}
          maxLength={50}
          className="h-4 text-[11px] py-0 px-1 flex-1 min-w-0"
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
          onBlur={handleSubmitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmitEdit()
            if (e.key === 'Escape') setEditing(null)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    ) : null

    return (
      <div key={group.id}>
        <ContextMenu open={openMenuId === group.id} onOpenChange={(o) => setOpenMenuId(o ? group.id : null)}>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'w-full flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-md text-[11px] transition-colors duration-150 group/row cursor-pointer select-none',
                isSelected
                  ? 'bg-primary/10 text-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium',
                isDragOver && 'ring-1 ring-primary/50 bg-primary/10',
              )}
              draggable={!isEditingThis}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-sw-group', group.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(SERVER_DRAG_MIME) || e.dataTransfer.types.includes('application/x-sw-group')) {
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverGroupId(group.id)
                }
              }}
              onDragLeave={(e) => {
                e.stopPropagation()
                setDragOverGroupId((prev) => (prev === group.id ? null : prev))
              }}
              onDrop={(e) => {
                const draggedGroup = e.dataTransfer.getData('application/x-sw-group')
                if (draggedGroup) {
                  void handleDropGroup(e, group.id, draggedGroup)
                } else {
                  void handleDropServers(e, group.id)
                }
              }}
              onClick={(e) => {
                e.stopPropagation()
                // 已选中状态下再次点击 → 进入行内重命名（类似 Windows 重命名文件夹）；系统分组「服务器」不可重命名
                if (isSelected && !isEditingThis && group.id !== HOST_GROUP_ID) {
                  setEditing({ mode: 'rename', groupId: group.id, value: group.name })
                  return
                }
                onSelectGroup(group.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                // 行内编辑（重命名）时不响应双击展开，避免输入框丢失
                if (isEditingThis) return
                toggleExpand(group.id)
              }}
            >
              <IndentGuides guides={node.guideLines} />
              {hasChildren ? (
                <button
                  className="flex-shrink-0 flex items-center justify-center h-3.5 w-3.5 rounded hover:bg-accent text-muted-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExpand(group.id)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={expanded ? t('group_collapse') : t('group_expand')}
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                  )}
                </button>
              ) : (
                <span className="flex-shrink-0 h-3.5 w-3.5" />
              )}
              <Folder
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/70 transition-colors',
                  isSelected && 'text-primary',
                )}
              />
              {isEditingThis ? (
                <Input
                  value={editing.value}
                  ref={focusEditingInput}
                  maxLength={50}
                  className="h-4 text-[11px] py-0 px-1 flex-1 min-w-0"
                  onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                  onBlur={handleSubmitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmitEdit()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="truncate flex-1 text-left">{group.name}</span>
              )}
              {!isEditingThis && count > 0 && (
                <span
                  className={cn(
                    'ml-auto flex-shrink-0 text-[10px] px-1 py-0.5 rounded-md font-mono tabular-nums transition-colors',
                    isSelected
                      ? 'bg-primary/15 text-foreground'
                      : 'text-muted-foreground/50 group-hover/row:bg-muted/70 group-hover/row:text-foreground',
                  )}
                >
                  {count}
                </span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => onAddServerToGroup?.(group.id)}>
              <Plus className="h-4 w-4" />
              {t('group_new_server')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setEditing({ mode: 'create', groupId: group.id, value: '' })}>
              <FolderPlus className="h-4 w-4" />
              {t('group_new_child')}
            </ContextMenuItem>
            {group.id !== HOST_GROUP_ID && (
              <ContextMenuItem onClick={() => setEditing({ mode: 'rename', groupId: group.id, value: group.name })}>
                <Pencil className="h-4 w-4" />
                {t('group_rename')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderTree className="h-4 w-4" />
                {t('group_move_to')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52 p-1">
                <GroupTreePicker
                  groups={serverGroups}
                  value={group.parentId || null}
                  onPick={(id) => {
                    handleMoveGroup(group.id, id)
                    setOpenMenuId(null)
                  }}
                  excludedIds={excluded}
                  size="compact"
                  pathMap={groupPathMap}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            {group.id !== HOST_GROUP_ID && (
              <ContextMenuItem onClick={() => setDeleteTarget(group)}>
                <Trash2 className="h-4 w-4" />
                {t('group_delete')}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>

        {/* 子分组（折叠时隐藏；但新建子分组时即使折叠也要显示输入框） */}
        {(hasChildren && expanded) || isCreatingChild ? (
          <div>
            {hasChildren && expanded && children.map((child) => renderNode(child))}
            {createInputRow}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex flex-col h-full min-h-0">
      {/* 分组区标题 + 新建根分组按钮 */}
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1 border-t border-border/40">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {t('group_section')}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="flex-shrink-0 flex items-center justify-center h-5 w-5 rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              onAddServerToGroup?.(HOST_GROUP_ID)
            }}
            title={t('dashboard_btn_add')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex-shrink-0 flex items-center justify-center h-5 w-5 rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation()
              setEditing({ mode: 'create', groupId: null, value: '' })
            }}
            title={t('group_new')}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 分组树（含默认分组根项于底部，互相独立、单选生效）*/}
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1">
        {tree.length > 0 ? (
          tree.map((node) => renderNode(node))
        ) : (
          <div className="px-2 py-1 text-[11px] text-muted-foreground/50 select-none">
            {t('group_empty_hint')}
          </div>
        )}

        {/* 根级新建输入框 */}
        {editing?.mode === 'create' && editing.groupId === null && (
          <div className="flex items-center gap-1 h-6 pl-1 pr-1.5">
            <span className="w-3.5 flex-shrink-0" />
            <span className="w-3.5 flex-shrink-0" />
            <Input
              value={editing.value}
              ref={focusEditingInput}
              placeholder={t('group_name_placeholder')}
              maxLength={50}
              className="h-4 text-[11px] py-0 px-1 flex-1 min-w-0"
              onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
              onBlur={handleSubmitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitEdit()
                if (e.key === 'Escape') setEditing(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}



      </div>

      {/* 我的收藏：分组区下方独立根过滤项（与分组块平级、单选生效）*/}
      <div className="pt-1.5 mt-1 border-t border-border/40">
        <div
          className={cn(
            'w-full flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-md text-[11px] transition-colors duration-150 group/row cursor-pointer select-none',
            selectedGroupId === 'favorites'
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelectGroup('favorites')
          }}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5 flex-shrink-0',
              selectedGroupId === 'favorites' ? 'text-amber-500 fill-amber-500/30' : 'text-muted-foreground/60',
            )}
          />
          <span className="truncate flex-1 text-left">{t('group_favorites')}</span>
          <span
            className={cn(
              'ml-auto flex-shrink-0 text-[10px] px-1 py-0.5 rounded-md font-mono tabular-nums transition-colors',
              selectedGroupId === 'favorites'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'text-muted-foreground/50 group-hover/row:bg-muted/70 group-hover/row:text-foreground',
            )}
          >
            {servers.filter((s) => s.favorite).length}
          </span>
        </div>
      </div>

      {/* 最近连接：分组区下方独立根过滤项（与收藏块平级、单选生效）*/}
      <div className="pt-1.5 mt-1 border-t border-border/40">
        <div
          className={cn(
            'w-full flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-md text-[11px] transition-colors duration-150 group/row cursor-pointer select-none',
            selectedGroupId === 'recent'
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onSelectGroup('recent')
          }}
        >
          <History
            className={cn(
              'h-3.5 w-3.5 flex-shrink-0',
              selectedGroupId === 'recent' ? 'text-primary' : 'text-muted-foreground/60',
            )}
          />
          <span className="truncate flex-1 text-left">{t('group_recent')}</span>
          <span
            className={cn(
              'ml-auto flex-shrink-0 text-[10px] px-1 py-0.5 rounded-md font-mono tabular-nums transition-colors',
              selectedGroupId === 'recent'
                ? 'bg-primary/15 text-foreground'
                : 'text-muted-foreground/50 group-hover/row:bg-muted/70 group-hover/row:text-foreground',
            )}
          >
            {recentServerIds.length}
          </span>
        </div>
      </div>

      {/* 回收站：待删除服务器 */}
      <div className="pt-1.5 mt-1 border-t border-border/40">
        <div
          className={cn(
            'w-full flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-md text-[11px] transition-colors duration-150 group/row cursor-pointer select-none',
            'text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium',
          )}
          onClick={(e) => {
            e.stopPropagation()
            onOpenTrash?.()
          }}
        >
          <Trash2
            className={cn(
              'h-3.5 w-3.5 flex-shrink-0',
              (trashCount ?? 0) > 0 ? 'text-amber-500' : 'text-muted-foreground/60',
            )}
          />
          <span className="truncate flex-1 text-left">{t('trash_title')}</span>
          {(trashCount ?? 0) > 0 && (
            <span className="ml-auto flex-shrink-0 text-[10px] px-1 py-0.5 rounded-md font-mono tabular-nums bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {trashCount}
            </span>
          )}
        </div>
      </div>

      {/* 删除分组确认 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('group_delete_title')}
        description={t('group_delete_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={t('group_delete_confirm')}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
        </div>
      </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onClick={() => onAddServerToGroup?.(HOST_GROUP_ID)}>
            <Plus className="h-4 w-4" />
            {t('group_new_server')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setEditing({ mode: 'create', groupId: null, value: '' })}>
            <FolderPlus className="h-4 w-4" />
            {t('group_new')}
          </ContextMenuItem>
        </ContextMenuContent>
    </ContextMenu>
  )
})
