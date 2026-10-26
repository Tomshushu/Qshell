import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFileExplorerPreferences } from '../use-file-explorer-preferences'
import { useAppStore } from '@/store'

describe('useFileExplorerPreferences - Interoperable Bookmarks between Workspace Files & SFTP', () => {
  beforeEach(() => {
    localStorage.clear()
    useAppStore.setState({
      pathBookmarks: {},
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shares bookmarks between workspace files and sftp remote for the same server', () => {
    const serverId = 'srv-prod-01'

    const { result: wsHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'workspace',
        serverId,
      })
    )

    const { result: sftpHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'sftp-remote',
        serverId,
      })
    )

    // 初始两边书签均为空
    expect(wsHook.current.bookmarks).toEqual([])
    expect(sftpHook.current.bookmarks).toEqual([])

    // 1. 在工作台文件模块中添加书签
    act(() => {
      wsHook.current.addBookmark('/var/log/nginx')
    })

    // 工作台与 SFTP 均应立刻能读到该书签
    expect(wsHook.current.bookmarks).toEqual(['/var/log/nginx'])
    expect(sftpHook.current.bookmarks).toEqual(['/var/log/nginx'])
    expect(wsHook.current.isBookmarked('/var/log/nginx')).toBe(true)
    expect(sftpHook.current.isBookmarked('/var/log/nginx')).toBe(true)

    // 2. 在 SFTP 远程模块中再添加一个书签
    act(() => {
      sftpHook.current.addBookmark('/home/deploy/app')
    })

    // 工作台与 SFTP 均应同时包含这两个书签
    expect(wsHook.current.bookmarks).toEqual(['/var/log/nginx', '/home/deploy/app'])
    expect(sftpHook.current.bookmarks).toEqual(['/var/log/nginx', '/home/deploy/app'])

    // 3. 在工作台文件模块中删除第一个书签
    act(() => {
      wsHook.current.removeBookmark('/var/log/nginx')
    })

    // 两边应同步移除
    expect(wsHook.current.bookmarks).toEqual(['/home/deploy/app'])
    expect(sftpHook.current.bookmarks).toEqual(['/home/deploy/app'])
    expect(wsHook.current.isBookmarked('/var/log/nginx')).toBe(false)
    expect(sftpHook.current.isBookmarked('/var/log/nginx')).toBe(false)

    // 4. 在 SFTP 模块中使用 toggleBookmark
    act(() => {
      sftpHook.current.toggleBookmark('/home/deploy/app') // 移除
    })
    expect(wsHook.current.bookmarks).toEqual([])
    expect(sftpHook.current.bookmarks).toEqual([])
  })

  it('keeps different servers bookmarks strictly isolated', () => {
    const { result: srv1Hook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'workspace',
        serverId: 'srv-1',
      })
    )

    const { result: srv2Hook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'sftp-remote',
        serverId: 'srv-2',
      })
    )

    act(() => {
      srv1Hook.current.addBookmark('/var/data-1')
      srv2Hook.current.addBookmark('/var/data-2')
    })

    expect(srv1Hook.current.bookmarks).toEqual(['/var/data-1'])
    expect(srv2Hook.current.bookmarks).toEqual(['/var/data-2'])
  })

  it('keeps local sftp bookmarks separate from remote server bookmarks', () => {
    const { result: localHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'sftp-local',
      })
    )

    const { result: remoteHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'workspace',
        serverId: 'srv-alpha',
      })
    )

    act(() => {
      localHook.current.addBookmark('C:\\Users\\Desktop')
      remoteHook.current.addBookmark('/root/code')
    })

    expect(localHook.current.bookmarks).toEqual(['C:\\Users\\Desktop'])
    expect(remoteHook.current.bookmarks).toEqual(['/root/code'])
  })

  it('unifies existing bookmarks from both legacy sftp and workspace store keys', () => {
    // 模拟既有数据中两处各自存了部分书签
    useAppStore.setState({
      pathBookmarks: {
        'sftp:srv-beta': ['/opt/sftp-only'],
        'workspace:srv-beta': ['/etc/ws-only'],
      },
    })

    const { result: wsHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'workspace',
        serverId: 'srv-beta',
      })
    )

    const { result: sftpHook } = renderHook(() =>
      useFileExplorerPreferences({
        scope: 'sftp-remote',
        serverId: 'srv-beta',
      })
    )

    // 两边读取时自动并集互通
    expect(wsHook.current.bookmarks).toEqual(['/opt/sftp-only', '/etc/ws-only'])
    expect(sftpHook.current.bookmarks).toEqual(['/opt/sftp-only', '/etc/ws-only'])
  })
})
