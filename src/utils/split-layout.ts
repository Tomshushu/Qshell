import type {
  DropZone,
  GroupLeafNode,
  SplitContainerNode,
  SplitDirection,
  SplitLayoutNode,
} from '@/types'

/** 分割比例允许的最小/最大值，防止把某个窗格拖到不可见 */
export const MIN_SPLIT_RATIO = 0.15
export const MAX_SPLIT_RATIO = 0.85

export function clampRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))
}

export function createGroupLeaf(groupId: string): GroupLeafNode {
  return { type: 'group', groupId }
}

/** 在布局树中查找指定分组的叶子节点 */
export function findGroupNode(node: SplitLayoutNode, groupId: string): GroupLeafNode | null {
  if (node.type === 'group') {
    return node.groupId === groupId ? node : null
  }
  return findGroupNode(node.children[0], groupId) ?? findGroupNode(node.children[1], groupId)
}

/**
 * 用 replacement 替换指定分组叶子（不可变更新）。
 * 分屏时：把目标叶子替换为一个新的 split 节点。
 */
export function replaceGroupNode(
  node: SplitLayoutNode,
  groupId: string,
  replacement: SplitLayoutNode,
): SplitLayoutNode {
  if (node.type === 'group') {
    return node.groupId === groupId ? replacement : node
  }
  const first = replaceGroupNode(node.children[0], groupId, replacement)
  const second = replaceGroupNode(node.children[1], groupId, replacement)
  if (first === node.children[0] && second === node.children[1]) return node
  return { ...node, children: [first, second] }
}

/**
 * 从布局树移除指定分组叶子，并让父 split 节点坍缩为兄弟子树。
 * 若整棵树被移除干净，返回 null。
 */
export function removeGroupNode(node: SplitLayoutNode, groupId: string): SplitLayoutNode | null {
  if (node.type === 'group') {
    return node.groupId === groupId ? null : node
  }
  const first = removeGroupNode(node.children[0], groupId)
  const second = removeGroupNode(node.children[1], groupId)
  // 未命中（引用均未变化）
  if (first === node.children[0] && second === node.children[1]) return node
  if (first === null) return second
  if (second === null) return first
  return { ...node, children: [first, second] }
}

/** 收集布局树中所有分组 ID（按视觉顺序） */
export function collectGroupIds(node: SplitLayoutNode | null): string[] {
  if (!node) return []
  if (node.type === 'group') return [node.groupId]
  return [...collectGroupIds(node.children[0]), ...collectGroupIds(node.children[1])]
}

/** 更新指定 split 节点的分割比例（不可变更新，自动 clamp） */
export function updateSplitRatio(
  node: SplitLayoutNode,
  splitId: string,
  ratio: number,
): SplitLayoutNode {
  if (node.type === 'group') return node
  const first = updateSplitRatio(node.children[0], splitId, ratio)
  const second = updateSplitRatio(node.children[1], splitId, ratio)
  if (node.id === splitId) {
    return { ...node, ratio: clampRatio(ratio), children: [first, second] }
  }
  if (first === node.children[0] && second === node.children[1]) return node
  return { ...node, children: [first, second] }
}

/**
 * 落点区域 → 分屏参数。
 * left/right → 左右分屏（row），top/bottom → 上下分屏（column）；
 * place 表示新分组相对目标分组的位置。
 */
export function zoneToSplit(zone: Exclude<DropZone, 'center'>): {
  direction: SplitDirection
  place: 'before' | 'after'
} {
  switch (zone) {
    case 'left':
      return { direction: 'row', place: 'before' }
    case 'right':
      return { direction: 'row', place: 'after' }
    case 'top':
      return { direction: 'column', place: 'before' }
    case 'bottom':
      return { direction: 'column', place: 'after' }
  }
}

/** 边缘判定比例：鼠标位于容器边缘 25% 区域内视为分屏落点 */
const EDGE_RATIO = 0.25

/** 根据鼠标在容器内的位置计算落点区域（allowCenter 为 false 时精准归纳到最靠近的四边缘之一：left / right / top / bottom，避免覆盖已有服务器） */
export function computeDropZone(clientX: number, clientY: number, rect: DOMRect, allowCenter = true): DropZone {
  const rx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5
  const ry = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5
  const left = rx
  const right = 1 - rx
  const top = ry
  const bottom = 1 - ry
  const min = Math.min(left, right, top, bottom)
  if (allowCenter && min > EDGE_RATIO) return 'center'
  if (min === left) return 'left'
  if (min === right) return 'right'
  if (min === top) return 'top'
  return 'bottom'
}

/** 构造一个分屏容器节点 */
export function createSplitNode(
  direction: SplitDirection,
  first: SplitLayoutNode,
  second: SplitLayoutNode,
  ratio = 0.5,
): SplitContainerNode {
  return {
    type: 'split',
    id: `split-${crypto.randomUUID()}`,
    direction,
    ratio: clampRatio(ratio),
    children: [first, second],
  }
}
