import { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, FolderOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { buildGroupTree, buildGroupPathMap, type GroupTreeNode } from '@/lib/server-groups'
import type { ServerGroup } from '@/types'

/**
 * VS Code 风格的分组树选择器（与侧边栏分组树视觉一致）：
 * 蓝色实心文件夹、层级缩进、折叠箭头、蓝色选中态、可选计数与「默认分组」项。
 *
 * - GroupTreePicker：纯树形内容（不含触发器/弹层），可嵌入弹窗、ContextMenu 子菜单等任意容器。
 * - GroupTreeSelect：带触发器按钮 + 弹出层，用于表单中替代原生/扁平的下拉选择分组。
 */

const INDENT = 'w-4 flex-shrink-0'

interface BaseProps {
  groups: ServerGroup[]
  /** 当前选中分组 ID；null / '' 表示未分组（默认分组 / 根目录） */
  value: string | null
  onPick: (id: string | null) => void
  /** 排除自身及子孙（移动分组到时避免成环） */
  excludedIds?: Set<string>
  /** 是否显示「默认分组 / 未分组」项，默认 true */
  showUngrouped?: boolean
  ungroupedLabel?: string
  /** 分组计数徽标（可选），key 为分组 ID */
  counts?: Map<string, number>
  ungroupedCount?: number
  /** 行高：compact = 24px（菜单内），default = 28px（表单弹层） */
  size?: 'compact' | 'default'
  className?: string
}

function IndentSpaces({ guides }: { guides: boolean[] }) {
  return (
    <>
      {guides.map((_, i) => (
        <span key={i} className={INDENT} />
      ))}
    </>
  )
}

function PickerNode({
  node,
  value,
  onPick,
  collapsed,
  toggle,
  counts,
  rowH,
  pathMap,
}: {
  node: GroupTreeNode
  value: string | null
  onPick: (id: string | null) => void
  collapsed: Set<string>
  toggle: (id: string) => void
  counts?: Map<string, number>
  rowH: string
  pathMap?: Map<string, string> | null
}) {
  const hasChildren = node.children.length > 0
  const expanded = !collapsed.has(node.group.id)
  const selected = value === node.group.id
  return (
    <div>
      <button
        type="button"
        onClick={() => onPick(node.group.id)}
        className={cn(
          'w-full flex items-center gap-1.5 rounded-md pl-1.5 pr-1.5 cursor-pointer select-none transition-colors',
          rowH,
          selected
            ? 'bg-primary/10 text-foreground font-semibold'
            : 'text-foreground hover:bg-accent/30',
        )}
      >
        <IndentSpaces guides={node.guideLines} />
        {hasChildren ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.group.id)
            }}
            className="flex-shrink-0 flex items-center justify-center h-4 w-4 rounded hover:bg-accent text-muted-foreground/70 cursor-pointer"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className={INDENT} />
        )}
        <Folder
          className={cn(
            'h-4 w-4 flex-shrink-0 text-primary fill-primary/20',
            selected && 'fill-primary/35',
          )}
        />
        <span className="truncate flex-1 text-left" title={pathMap ? pathMap.get(node.group.id) : undefined}>
          {pathMap ? pathMap.get(node.group.id) ?? node.group.name : node.group.name}
        </span>
        {counts?.get(node.group.id) != null && (
          <span className="ml-auto flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-mono tabular-nums text-muted-foreground/60 group-hover/row:bg-muted/70">
            {counts.get(node.group.id)}
          </span>
        )}
      </button>
      {expanded &&
        node.children.map((child) => (
          <PickerNode
            key={child.group.id}
            node={child}
            value={value}
            onPick={onPick}
            collapsed={collapsed}
            toggle={toggle}
            counts={counts}
            rowH={rowH}
          />
        ))}
    </div>
  )
}

export function GroupTreePicker({
  groups,
  value,
  onPick,
  excludedIds,
  showUngrouped = false,
  ungroupedLabel,
  counts,
  ungroupedCount,
  size = 'compact',
  className,
  pathMap,
}: BaseProps & { pathMap?: Map<string, string> | null }) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => buildGroupTree(groups, excludedIds), [groups, excludedIds])
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const rowH = size === 'compact' ? 'h-6' : 'h-7'
  const isUngrouped = !value
  return (
    <div className={cn('w-full select-none text-xs', className)}>
      {showUngrouped && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className={cn(
            'w-full flex items-center gap-1.5 rounded-md pl-1.5 pr-1.5 cursor-pointer select-none transition-colors',
            rowH,
            isUngrouped
              ? 'bg-primary/10 text-foreground font-semibold'
              : 'text-foreground hover:bg-accent/30',
          )}
        >
          <span className={INDENT} />
          <Folder
            className={cn(
              'h-4 w-4 flex-shrink-0 text-primary fill-primary/20',
              isUngrouped && 'fill-primary/35',
            )}
          />
          <span className="truncate flex-1 text-left">{ungroupedLabel ?? t('group_ungrouped')}</span>
          {ungroupedCount != null && (
            <span className="ml-auto flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-mono tabular-nums text-muted-foreground/60">
              {ungroupedCount}
            </span>
          )}
        </button>
      )}
      {tree.map((node) => (
        <PickerNode
          key={node.group.id}
          node={node}
          value={value}
          onPick={onPick}
          collapsed={collapsed}
          toggle={toggle}
          counts={counts}
          rowH={rowH}
          pathMap={pathMap}
        />
      ))}
    </div>
  )
}

export interface GroupTreeSelectProps {
  groups: ServerGroup[]
  value: string | null
  onChange: (id: string | null) => void
  ungroupedLabel?: string
  excludedIds?: Set<string>
  counts?: Map<string, number>
  ungroupedCount?: number
  placeholder?: string
  className?: string
  /** 是否在下拉树与触发器中显示完整路径（如「服务器/公司/内网」），默认 true */
  showPath?: boolean
}

export function GroupTreeSelect({
  groups,
  value,
  onChange,
  ungroupedLabel,
  excludedIds,
  counts,
  ungroupedCount,
  placeholder,
  className,
  showPath = true,
}: GroupTreeSelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pathMap = useMemo(
    () => (showPath ? buildGroupPathMap(groups) : null),
    [showPath, groups],
  )

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const currentName = value ? (pathMap ? pathMap.get(value) : groups.find((g) => g.id === value)?.name) : null
  const label = currentName ?? ungroupedLabel ?? placeholder ?? t('group_ungrouped')

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-7 min-w-[120px] flex items-center justify-between gap-1.5 rounded-lg border pl-2.5 pr-2 text-xs font-medium outline-none transition-colors cursor-pointer',
          value
            ? 'border-primary/40 text-primary bg-primary/5'
            : 'border-border/50 text-muted-foreground bg-muted/30 hover:bg-accent/60',
          className,
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Folder className="h-4 w-4 flex-shrink-0 text-primary fill-primary/20" />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 rounded-lg border bg-popover shadow-md p-1 w-56 max-h-64 overflow-auto">
          <GroupTreePicker
            groups={groups}
            value={value}
            onPick={(id) => {
              onChange(id)
              setOpen(false)
            }}
            excludedIds={excludedIds}
            ungroupedLabel={ungroupedLabel}
            counts={counts}
            ungroupedCount={ungroupedCount}
            size="default"
            pathMap={pathMap}
          />
        </div>
      )}
    </div>
  )
}

export const UNGROUPED_FILTER = '__ungrouped__'

export interface GroupFilterChipProps {
  groups: ServerGroup[]
  value: string | null
  onChange: (v: string | null) => void
  counts: Map<string, number>
  ungroupedCount: number
  className?: string
}

/**
 * 分组筛选 Chip 按钮及下拉弹层（与 SFTP 面板选服及打开其他服务器弹窗风格一致）
 */
export function GroupFilterChip({
  groups,
  value,
  onChange,
  counts,
  ungroupedCount,
  className,
}: GroupFilterChipProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const isUngrouped = value === UNGROUPED_FILTER
  const selected = value && !isUngrouped ? groups.find((g) => g.id === value) : undefined
  const label = selected
    ? selected.name
    : isUngrouped
      ? t('group_ungrouped')
      : t('group_filter_all')

  const pick = (v: string | null) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={selected ? selected.name : undefined}
        className={cn(
          'px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer inline-flex items-center gap-1 max-w-[160px]',
          selected || isUngrouped
            ? 'bg-primary/10 text-primary hover:bg-primary/20'
            : 'bg-muted/60 text-muted-foreground hover:text-foreground',
        )}
      >
        <Folder className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('h-3 w-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-56 rounded-lg border bg-popover shadow-md p-1.5">
          {/* 全部分组：清除分组筛选 */}
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              'w-full flex items-center gap-1.5 rounded-md px-1.5 h-7 text-xs cursor-pointer transition-colors',
              value === null ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-accent/40',
            )}
          >
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="truncate flex-1 text-left">{t('group_filter_all')}</span>
          </button>

          {/* 分组树（计数 = 标签/搜索过滤后的子树服务器数） */}
          <div className="max-h-56 overflow-y-auto">
            <GroupTreePicker groups={groups} value={value} onPick={pick} counts={counts} />
          </div>

          {/* 未分组（仅在实际存在未分组服务器或当前正在筛选未分组时展示） */}
          {(ungroupedCount > 0 || isUngrouped) && (
            <>
              {groups.length > 0 && <div className="my-1 border-t border-border/50" />}
              <button
                type="button"
                onClick={() => pick(UNGROUPED_FILTER)}
                className={cn(
                  'w-full flex items-center gap-1.5 rounded-md px-1.5 h-7 text-xs cursor-pointer transition-colors',
                  isUngrouped ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-accent/40',
                )}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="truncate flex-1 text-left">{t('group_ungrouped')}</span>
                {ungroupedCount > 0 && (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-mono tabular-nums text-muted-foreground/60">
                    {ungroupedCount}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
