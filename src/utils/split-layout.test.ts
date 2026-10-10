import { describe, it, expect } from 'vitest'
import {
  clampRatio,
  collectGroupIds,
  computeDropZone,
  createGroupLeaf,
  createSplitNode,
  findGroupNode,
  removeGroupNode,
  replaceGroupNode,
  updateSplitRatio,
  zoneToSplit,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
} from './split-layout'
import type { SplitLayoutNode } from '@/types'

/** 构造一棵两层 T 字型布局树：根左右分，右侧再上下分 */
function makeTree(): SplitLayoutNode {
  //  [A | (B / C)]  —— 典型 T 字结构
  const right = createSplitNode('column', createGroupLeaf('B'), createGroupLeaf('C'), 0.5)
  return createSplitNode('row', createGroupLeaf('A'), right, 0.6)
}

describe('findGroupNode', () => {
  it('能找到树中任意深度的分组叶子', () => {
    const tree = makeTree()
    expect(findGroupNode(tree, 'A')?.groupId).toBe('A')
    expect(findGroupNode(tree, 'B')?.groupId).toBe('B')
    expect(findGroupNode(tree, 'C')?.groupId).toBe('C')
    expect(findGroupNode(tree, 'X')).toBeNull()
  })
})

describe('replaceGroupNode（分屏插入）', () => {
  it('把目标叶子替换为 split 节点，原树其余部分不变', () => {
    const tree = makeTree()
    const split = createSplitNode('row', createGroupLeaf('B'), createGroupLeaf('NEW'))
    const next = replaceGroupNode(tree, 'B', split)
    expect(collectGroupIds(next)).toEqual(['A', 'B', 'NEW', 'C'])
    // 原树不被修改（不可变更新）
    expect(collectGroupIds(tree)).toEqual(['A', 'B', 'C'])
    // C 仍然可找
    expect(findGroupNode(next, 'C')).not.toBeNull()
  })

  it('替换不存在的分组时原样返回', () => {
    const tree = makeTree()
    expect(replaceGroupNode(tree, 'X', createGroupLeaf('Y'))).toBe(tree)
  })
})

describe('removeGroupNode（关闭分组坍缩）', () => {
  it('移除叶子后父 split 坍缩为兄弟子树', () => {
    const tree = makeTree()
    // 移除 B：右侧 column split 应坍缩为 C
    const next = removeGroupNode(tree, 'B')
    expect(next).not.toBeNull()
    expect(collectGroupIds(next)).toEqual(['A', 'C'])
    // 根节点仍是 row split，但右子树直接是 C 叶子
    expect(next!.type).toBe('split')
    if (next!.type === 'split') {
      expect(next!.children[1]).toEqual({ type: 'group', groupId: 'C' })
    }
  })

  it('移除至只剩一个分组时返回该分组叶子', () => {
    const tree = makeTree()
    let cur: SplitLayoutNode | null = tree
    cur = removeGroupNode(cur!, 'A')
    cur = removeGroupNode(cur!, 'B')
    expect(cur).toEqual({ type: 'group', groupId: 'C' })
  })

  it('移除最后一个分组返回 null', () => {
    const leaf = createGroupLeaf('A')
    expect(removeGroupNode(leaf, 'A')).toBeNull()
  })
})

describe('updateSplitRatio（自适应比例）', () => {
  it('更新指定 split 的比例并 clamp 到安全范围', () => {
    const tree = makeTree()
    if (tree.type !== 'split') throw new Error('unexpected')
    const next = updateSplitRatio(tree, tree.id, 0.05)
    if (next.type !== 'split') throw new Error('unexpected')
    expect(next.ratio).toBe(MIN_SPLIT_RATIO)
    const next2 = updateSplitRatio(tree, tree.id, 0.99)
    if (next2.type !== 'split') throw new Error('unexpected')
    expect(next2.ratio).toBe(MAX_SPLIT_RATIO)
  })
})

describe('zoneToSplit / computeDropZone（拖拽落点）', () => {
  it('四个边缘映射到正确的方向与位置', () => {
    expect(zoneToSplit('left')).toEqual({ direction: 'row', place: 'before' })
    expect(zoneToSplit('right')).toEqual({ direction: 'row', place: 'after' })
    expect(zoneToSplit('top')).toEqual({ direction: 'column', place: 'before' })
    expect(zoneToSplit('bottom')).toEqual({ direction: 'column', place: 'after' })
  })

  it('容器边缘 25% 内为对应方向，中心为 center', () => {
    const rect = { left: 0, top: 0, width: 400, height: 200 } as DOMRect
    expect(computeDropZone(10, 100, rect)).toBe('left')     // x=2.5%
    expect(computeDropZone(390, 100, rect)).toBe('right')   // x=97.5%
    expect(computeDropZone(200, 5, rect)).toBe('top')       // y=2.5%
    expect(computeDropZone(200, 195, rect)).toBe('bottom')  // y=97.5%
    expect(computeDropZone(200, 100, rect)).toBe('center')  // 正中
  })
})

describe('clampRatio', () => {
  it('限制在安全范围内', () => {
    expect(clampRatio(0)).toBe(MIN_SPLIT_RATIO)
    expect(clampRatio(1)).toBe(MAX_SPLIT_RATIO)
    expect(clampRatio(0.5)).toBe(0.5)
  })
})
