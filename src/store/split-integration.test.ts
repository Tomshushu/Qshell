import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import { collectGroupIds } from '@/utils/split-layout'
import type { Server } from '@/types'

/**
 * 分屏布局的 store 级集成测试：
 * 模拟「打开标签 → 分屏 → 组间移动 → 关闭坍缩」的完整状态流转。
 */

function resetStore() {
  useAppStore.setState({
    servers: [],
    tabs: [],
    groups: {},
    layout: null,
    activeTabId: null,
    lastActiveGroupId: null,
    splitDropTarget: null,
  })
}

function state() {
  return useAppStore.getState()
}

describe('分屏布局集成', () => {
  beforeEach(resetStore)

  it('首个 tab 创建默认分组与单叶子布局', () => {
    state().openTab('srv-1', 'Server 1', 'terminal')
    const s = state()
    expect(s.tabs.length).toBe(1)
    expect(Object.keys(s.groups).length).toBe(1)
    expect(s.layout).not.toBeNull()
    expect(s.layout!.type).toBe('group')
    const gid = s.tabs[0].groupId!
    expect(s.groups[gid].activeTabId).toBe(s.tabs[0].id)
    expect(s.lastActiveGroupId).toBe(gid)
  })

  it('连续打开的 tab 建立各自独立分组（顶层独立标签）', () => {
    state().openTab('srv-1', 'Server 1', 'terminal')
    state().openTab('srv-2', 'Server 2', 'terminal')
    const s = state()
    expect(s.tabs.length).toBe(2)
    expect(Object.keys(s.groups).length).toBe(2)
    expect(s.tabs[0].groupId).not.toBe(s.tabs[1].groupId)
  })

  it('splitTab 向右分屏：形成二叉树，tab 进入新分组', () => {
    state().openTab('srv-1', 'Server 1', 'terminal')
    state().openTab('srv-2', 'Server 2', 'terminal')
    const [tab1, tab2] = state().tabs
    const gid = tab1.groupId!

    state().splitTab(tab2.id, gid, 'row', 'after')
    const s = state()
    expect(Object.keys(s.groups).length).toBe(2)
    expect(s.layout!.type).toBe('split')
    if (s.layout!.type === 'split') {
      expect(s.layout!.direction).toBe('row')
      expect(s.layout!.ratio).toBe(0.5)
      // [原组 | 新组]
      expect(s.layout!.children[0]).toEqual({ type: 'group', groupId: gid })
    }
    const newGid = state().tabs.find((t) => t.id === tab2.id)!.groupId!
    expect(newGid).not.toBe(gid)
    expect(s.groups[newGid].activeTabId).toBe(tab2.id)
    expect(s.groups[gid].activeTabId).toBe(tab1.id)
    expect(s.activeTabId).toBe(tab2.id)
  })

  it('T 字型三级分屏：[A | (B / C)]', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    state().openTab('srv-3', 'C', 'terminal')
    const [tabA, tabB, tabC] = state().tabs
    const gidA = tabA.groupId!

    // B 拆到 A 右侧
    state().splitTab(tabB.id, gidA, 'row', 'after')
    const gidB = state().tabs.find((t) => t.id === tabB.id)!.groupId!
    // C 拆到 B 下方
    state().splitTab(tabC.id, gidB, 'column', 'after')

    const s = state()
    expect(Object.keys(s.groups).length).toBe(3)
    expect(collectGroupIds(s.layout)).toHaveLength(3)
    // 根节点：row split
    if (s.layout!.type !== 'split') throw new Error('root should be split')
    expect(s.layout!.direction).toBe('row')
    // 右子树：column split（T 字型标志）
    const right = s.layout!.children[1]
    if (right.type !== 'split') throw new Error('right subtree should be split')
    expect(right.direction).toBe('column')
  })

  it('moveTabToGroup 移空源分组后布局自动坍缩回单组', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA, tabB] = state().tabs
    const gidA = tabA.groupId!

    state().splitTab(tabB.id, gidA, 'row', 'after')
    expect(Object.keys(state().groups).length).toBe(2)

    // 把 B 移回原组 → 新分组变空 → 布局坍缩
    state().moveTabToGroup(tabB.id, gidA)
    const s = state()
    expect(Object.keys(s.groups).length).toBe(1)
    expect(s.layout!.type).toBe('group')
    expect(s.tabs.every((t) => t.groupId === gidA)).toBe(true)
  })

  it('同组单 tab 不可拆分（拒绝无意义分屏）', () => {
    state().openTab('srv-1', 'A', 'terminal')
    const tab = state().tabs[0]
    state().splitTab(tab.id, tab.groupId!, 'row', 'after')
    const s = state()
    expect(Object.keys(s.groups).length).toBe(1)
    expect(s.layout!.type).toBe('group')
  })

  it('closeTab 关闭分组最后一个 tab 时分组坍缩', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA, tabB] = state().tabs
    state().splitTab(tabB.id, tabA.groupId!, 'row', 'after')
    expect(Object.keys(state().groups).length).toBe(2)

    state().closeTab(tabB.id)
    const s = state()
    expect(Object.keys(s.groups).length).toBe(1)
    expect(s.layout!.type).toBe('group')
    expect(s.activeTabId).toBe(tabA.id)
  })

  it('关闭全部 tab 后布局清空', () => {
    state().openTab('srv-1', 'A', 'terminal')
    const tab = state().tabs[0]
    state().closeTab(tab.id)
    const s = state()
    expect(s.tabs).toHaveLength(0)
    expect(s.groups).toEqual({})
    expect(s.layout).toBeNull()
    expect(s.activeTabId).toBeNull()
  })

  it('resizeSplit 调整比例并 clamp', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA, tabB] = state().tabs
    state().splitTab(tabB.id, tabA.groupId!, 'row', 'after')
    const layout = state().layout!
    if (layout.type !== 'split') throw new Error('should be split')

    state().resizeSplit(layout.id, 0.7)
    let cur = state().layout!
    if (cur.type !== 'split') throw new Error('should be split')
    expect(cur.ratio).toBe(0.7)

    state().resizeSplit(layout.id, 0.01)
    cur = state().layout!
    if (cur.type !== 'split') throw new Error('should be split')
    expect(cur.ratio).toBe(0.15)
  })

  it('新打开的 tab 为独立顶层标签，不自动侵入已有分屏工作区', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA, tabB] = state().tabs
    const gidA = tabA.groupId!
    state().splitTab(tabB.id, gidA, 'row', 'after')

    state().openTab('srv-3', 'C', 'terminal')
    const tabC = state().tabs.find((t) => t.serverName === 'C')!
    expect(tabC.groupId).not.toBe(gidA)
    expect(tabC.groupId).not.toBe(tabB.groupId)
  })

  it('setActiveTab 同步组内活跃 tab 与最近分组', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA] = state().tabs
    const gid = tabA.groupId!
    state().setActiveTab(null)
    expect(state().activeTabId).toBeNull()
    state().setActiveTab(tabA.id)
    expect(state().groups[gid].activeTabId).toBe(tabA.id)
    expect(state().lastActiveGroupId).toBe(gid)
  })

  it('同一物理串口重复双击只聚焦已有工作台', () => {
    useAppStore.setState({
      servers: [
        { id: 'serial-a', name: 'Console A', host: 'COM10', port: 115200, targetType: 'serial', protocol: 'serial', protocols: ['serial'], serialConfig: JSON.stringify({ portName: 'COM10', baudRate: 115200 }) },
        { id: 'serial-b', name: 'Console B', host: 'com10', port: 9600, targetType: 'serial', protocol: 'serial', protocols: ['serial'], serialConfig: JSON.stringify({ portName: 'com10', baudRate: 9600 }) },
      ] as unknown as Server[],
    })
    state().openTab('serial-a', 'Console A', 'terminal')
    const originalId = state().tabs[0].id
    state().openTab('serial-b', 'Console B', 'terminal')
    expect(state().tabs).toHaveLength(1)
    expect(state().activeTabId).toBe(originalId)
  })

  it('批量打开会过滤已占用和批次内重复的串口', () => {
    useAppStore.setState({
      servers: [
        { id: 'serial-a', name: 'A', host: 'COM3', port: 115200, targetType: 'serial', protocol: 'serial', protocols: ['serial'] },
        { id: 'serial-b', name: 'B', host: 'COM3', port: 115200, targetType: 'serial', protocol: 'serial', protocols: ['serial'] },
        { id: 'serial-c', name: 'C', host: 'COM4', port: 115200, targetType: 'serial', protocol: 'serial', protocols: ['serial'] },
      ] as unknown as Server[],
    })
    state().openServersInSplit([
      { serverId: 'serial-a', serverName: 'A', module: 'terminal' },
      { serverId: 'serial-b', serverName: 'B', module: 'terminal' },
      { serverId: 'serial-c', serverName: 'C', module: 'terminal' },
    ])
    expect(state().tabs.map((tab) => tab.serverId).sort()).toEqual(['serial-a', 'serial-c'])
  })

  it('closeOtherTabsInWorkspace 仅关闭同一工作区内未锁定的其它标签', () => {
    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    state().openTab('srv-3', 'C', 'terminal')
    const [tabA, tabB, tabC] = state().tabs
    state().splitTab(tabB.id, tabA.groupId!, 'row', 'after')
    state().splitTab(tabC.id, tabB.groupId!, 'row', 'after')

    // 锁定 tabC
    state().toggleTabLock(tabC.id)

    // 在 tabA 上关闭其他
    state().closeOtherTabsInWorkspace(tabA.id)

    const remainingIds = state().tabs.map((t) => t.id)
    // tabA 和锁定的 tabC 应当保留，未锁定的 tabB 被关闭
    expect(remainingIds).toContain(tabA.id)
    expect(remainingIds).toContain(tabC.id)
    expect(remainingIds).not.toContain(tabB.id)
    expect(state().activeTabId).toBe(tabA.id)
  })

  it('分屏工作区标签颜色独立于子服务器标签颜色，且支持恢复默认颜色', () => {
    // 为 srv-1 预先设置服务器专属颜色
    useAppStore.setState({
      tabColors: { 'srv-1': '#ef4444' },
    })

    state().openTab('srv-1', 'A', 'terminal')
    state().openTab('srv-2', 'B', 'terminal')
    const [tabA, tabB] = state().tabs
    expect(tabA.color).toBe('#ef4444')

    // 将 B 拖拽分屏到 A
    state().splitTab(tabB.id, tabA.groupId!, 'row', 'after')

    const workspaces = Object.values(state().workspaces)
    expect(workspaces).toHaveLength(1)
    const ws = workspaces[0]
    // 新建的分屏工作区标签不应自动继承子服务器的颜色
    expect(ws.color).toBeUndefined()

    // 手动为 workspace 设置自定义颜色
    state().setWorkspaceColor(ws.id, '#3b82f6')
    expect(state().workspaces[ws.id].color).toBe('#3b82f6')

    // 恢复为默认颜色（undefined）
    state().setWorkspaceColor(ws.id, undefined)
    expect(state().workspaces[ws.id].color).toBeUndefined()
  })
})

