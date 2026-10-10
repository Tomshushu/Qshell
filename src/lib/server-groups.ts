/**
 * 服务器分组（树形目录）共享工具。
 *
 * 独立成文件的原因：react-refresh/only-export-components 要求组件文件只导出组件，
 * 常量/函数需放到非组件模块，供 dashboard 页面与分组树组件共用。
 */
import type { ServerGroup } from '@/types'

/** 顶级分组「主机」的固定 ID；所有未分组的服务器及新建分组默认归属它，形成单一树根 */
export const HOST_GROUP_ID = 'host'
/** 顶级分组「主机」的默认名称 */
export const HOST_GROUP_NAME = '主机'

/** 服务器卡片 / 列表行拖拽到分组时使用的 dataTransfer 类型 */
export const SERVER_DRAG_MIME = 'application/x-sw-servers'

/** 计算分组自身及全部后代分组 ID（含自身） */
export function collectSubtreeIds(groups: ServerGroup[], rootId: string): Set<string> {
  const result = new Set<string>([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const g of groups) {
      if (g.parentId && result.has(g.parentId) && !result.has(g.id)) {
        result.add(g.id)
        changed = true
      }
    }
  }
  return result
}

/** 右键菜单「移动到分组」等场景用的树形分组选项 */
export interface GroupMenuOption {
  id: string
  label: string
  depth: number
}

/**
 * 将扁平分组列表展平为按名称排序的树形选项。
 * @param excludedIds 需排除的分组及其子孙（如移动自身时避免成环）
 */
export function flattenGroupsForMenu(
  groups: ServerGroup[],
  excludedIds?: Set<string>,
): GroupMenuOption[] {
  const out: GroupMenuOption[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children = groups
      .filter((g) => (g.parentId ?? null) === parentId)
      .filter((g) => !excludedIds?.has(g.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const g of children) {
      out.push({ id: g.id, label: g.name, depth })
      walk(g.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** 树形分组节点（侧边栏分组树 / 分组选择器共用的数据结构） */
export interface GroupTreeNode {
  group: ServerGroup
  children: GroupTreeNode[]
  depth: number
  /** 是否为同层最后一个节点 */
  isLast: boolean
  /** 各祖先层级是否需要绘制续接引导线的标记 */
  guideLines: boolean[]
}

/**
 * 将扁平分组列表构建为树（按 parentId 递归、按名称排序），
 * 并计算每个节点的深度、是否末位、以及祖先续接引导线标记。
 * @param excludedIds 需排除的分组及其子孙（如移动分组自身时避免成环）
 */
export function buildGroupTree(
  groups: ServerGroup[],
  excludedIds?: Set<string>,
): GroupTreeNode[] {
  const byParent = new Map<string | null, ServerGroup[]>()
  for (const g of groups) {
    if (excludedIds?.has(g.id)) continue
    const key = g.parentId ?? null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(g)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }
  const build = (parentId: string | null, depth: number, guideLines: boolean[]): GroupTreeNode[] =>
    (byParent.get(parentId) ?? []).map((group, index, arr) => {
      const isLast = index === arr.length - 1
      return {
        group,
        depth,
        isLast,
        guideLines,
        children: build(group.id, depth + 1, [...guideLines, !isLast]),
      }
    })
  return build(null, 0, [])
}

/**
 * 计算每个分组的完整路径（以虚拟根「服务器」为前缀，形如「服务器/公司/内网」）。
 * 用于分组选择器、移动分组等场景展示层级归属，避免重名歧义。
 */
export function buildGroupPathMap(groups: ServerGroup[]): Map<string, string> {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const cache = new Map<string, string>()
  const visiting = new Set<string>()
  const getPath = (g: ServerGroup): string => {
    const cached = cache.get(g.id)
    if (cached) return cached
    if (visiting.has(g.id)) {
      // 防御：分组树出现环（理论上不应发生），直接以当前节点收尾
      const fallback = `${HOST_GROUP_NAME}/${g.name}`
      cache.set(g.id, fallback)
      return fallback
    }
    visiting.add(g.id)
    const parent = g.parentId ? byId.get(g.parentId) : undefined
    // 路径仅由真实分组链组成：顶级分组就是它自己的名字（不再硬拼虚拟根「服务器」），
    // 这样顶级分组若命名为「服务器」也只出现一次，与用户期望的「服务器/公司/内网」一致
    const path = parent ? `${getPath(parent)}/${g.name}` : g.name
    visiting.delete(g.id)
    cache.set(g.id, path)
    return path
  }
  const map = new Map<string, string>()
  for (const g of groups) map.set(g.id, getPath(g))
  return map
}
