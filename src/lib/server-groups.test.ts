import { describe, it, expect } from 'vitest'
import {
  HOST_GROUP_ID,
  HOST_GROUP_NAME,
  collectSubtreeIds,
  flattenGroupsForMenu,
  buildGroupTree,
  buildGroupPathMap,
} from './server-groups'
import type { ServerGroup } from '@/types'

function makeGroup(id: string, name: string, parentId: string | null = null): ServerGroup {
  return {
    id,
    name,
    parentId,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('server-groups utility', () => {
  describe('collectSubtreeIds', () => {
    it('returns only the root id if no children exist', () => {
      const groups = [makeGroup('g1', 'Group 1'), makeGroup('g2', 'Group 2')]
      const res = collectSubtreeIds(groups, 'g1')
      expect(Array.from(res)).toEqual(['g1'])
    })

    it('collects direct and multi-level descendants', () => {
      const groups = [
        makeGroup('root', 'Root'),
        makeGroup('c1', 'Child 1', 'root'),
        makeGroup('c2', 'Child 2', 'root'),
        makeGroup('gc1', 'Grandchild 1', 'c1'),
        makeGroup('other', 'Other'),
      ]
      const res = collectSubtreeIds(groups, 'root')
      expect(Array.from(res).sort()).toEqual(['c1', 'c2', 'gc1', 'root'])
    })

    it('terminates safely even if a cyclic relation exists', () => {
      // Cycle: a -> b -> a
      const groups = [
        makeGroup('a', 'A', 'b'),
        makeGroup('b', 'B', 'a'),
      ]
      const res = collectSubtreeIds(groups, 'a')
      expect(res.has('a')).toBe(true)
      expect(res.has('b')).toBe(true)
    })
  })

  describe('flattenGroupsForMenu', () => {
    it('flattens hierarchy into sorted options with depth', () => {
      const groups = [
        makeGroup('b', 'Beta', null),
        makeGroup('a', 'Alpha', null),
        makeGroup('a2', 'Alpha 10', 'a'),
        makeGroup('a1', 'Alpha 2', 'a'),
      ]
      const options = flattenGroupsForMenu(groups)
      // Natural sort: Alpha before Beta; Alpha 2 before Alpha 10
      expect(options).toEqual([
        { id: 'a', label: 'Alpha', depth: 0 },
        { id: 'a1', label: 'Alpha 2', depth: 1 },
        { id: 'a2', label: 'Alpha 10', depth: 1 },
        { id: 'b', label: 'Beta', depth: 0 },
      ])
    })

    it('filters out excluded IDs and their descendants', () => {
      const groups = [
        makeGroup('root', 'Root'),
        makeGroup('child', 'Child', 'root'),
        makeGroup('other', 'Other'),
      ]
      const excluded = collectSubtreeIds(groups, 'root')
      const options = flattenGroupsForMenu(groups, excluded)
      expect(options).toEqual([{ id: 'other', label: 'Other', depth: 0 }])
    })
  })

  describe('buildGroupTree', () => {
    it('builds nested tree structure with guideLines and isLast flags', () => {
      const groups = [
        makeGroup('g1', 'G1'),
        makeGroup('g2', 'G2'),
        makeGroup('sub1', 'Sub1', 'g1'),
        makeGroup('sub2', 'Sub2', 'g1'),
      ]
      const tree = buildGroupTree(groups)
      expect(tree).toHaveLength(2)

      // G1
      const g1Node = tree[0]
      expect(g1Node.group.name).toBe('G1')
      expect(g1Node.isLast).toBe(false)
      expect(g1Node.depth).toBe(0)
      expect(g1Node.guideLines).toEqual([])
      expect(g1Node.children).toHaveLength(2)

      // G1 -> Sub1
      const sub1Node = g1Node.children[0]
      expect(sub1Node.group.name).toBe('Sub1')
      expect(sub1Node.isLast).toBe(false)
      expect(sub1Node.depth).toBe(1)
      expect(sub1Node.guideLines).toEqual([true]) // parent has next sibling, so guideline is true

      // G1 -> Sub2
      const sub2Node = g1Node.children[1]
      expect(sub2Node.isLast).toBe(true)
      expect(sub2Node.depth).toBe(1)

      // G2
      const g2Node = tree[1]
      expect(g2Node.group.name).toBe('G2')
      expect(g2Node.isLast).toBe(true)
      expect(g2Node.children).toHaveLength(0)
    })

    it('excludes subtrees passed in excludedIds', () => {
      const groups = [
        makeGroup('p1', 'Parent 1'),
        makeGroup('c1', 'Child 1', 'p1'),
        makeGroup('p2', 'Parent 2'),
      ]
      const tree = buildGroupTree(groups, new Set(['p1']))
      expect(tree).toHaveLength(1)
      expect(tree[0].group.id).toBe('p2')
    })
  })

  describe('buildGroupPathMap', () => {
    it('resolves paths for top-level and nested groups', () => {
      const groups = [
        makeGroup('g1', 'Company'),
        makeGroup('g2', 'Prod', 'g1'),
        makeGroup('g3', 'Web', 'g2'),
        makeGroup('solo', 'Dev'),
      ]
      const pathMap = buildGroupPathMap(groups)
      expect(pathMap.get('g1')).toBe('Company')
      expect(pathMap.get('g2')).toBe('Company/Prod')
      expect(pathMap.get('g3')).toBe('Company/Prod/Web')
      expect(pathMap.get('solo')).toBe('Dev')
    })

    it('falls back gracefully on cyclic dependencies without infinite recursion', () => {
      const groups = [
        makeGroup('c1', 'Cycle1', 'c2'),
        makeGroup('c2', 'Cycle2', 'c1'),
      ]
      const pathMap = buildGroupPathMap(groups)
      expect(pathMap.get('c1')).toBeDefined()
      expect(pathMap.get('c2')).toBeDefined()
      // Should include fallback host group name
      expect(pathMap.get('c1')).toContain(HOST_GROUP_NAME)
    })
  })
})
