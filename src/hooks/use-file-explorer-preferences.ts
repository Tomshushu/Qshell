import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import { toBaseServerId } from '@/components/sftp/sftp-utils'

export type FileExplorerScope = 'sftp-local' | 'sftp-remote' | 'workspace'

export interface UseFileExplorerPreferencesOptions {
  scope: FileExplorerScope
  serverId?: string
  onToast?: {
    success?: (msg: string) => void
    info?: (msg: string) => void
    warning?: (msg: string) => void
  }
}

export function useFileExplorerPreferences({
  scope,
  serverId,
  onToast,
}: UseFileExplorerPreferencesOptions) {
  const baseServerId = serverId ? toBaseServerId(serverId) : ''

  const scopeKey = useMemo(() => {
    if (scope === 'sftp-local') return 'sftp:local'
    if (scope === 'sftp-remote') return `sftp:${baseServerId}`
    return `workspace:${baseServerId}`
  }, [scope, baseServerId])

  // Zustand Store selectors
  const pathBookmarks = useAppStore((s) => s.pathBookmarks)
  const addPathBookmarkAction = useAppStore((s) => s.addPathBookmark)
  const removePathBookmarkAction = useAppStore((s) => s.removePathBookmark)

  // Scope Bookmarks: 针对同一服务器，工作台文件与SFTP远程面板收藏路径互通
  const bookmarks = useMemo(() => {
    if (scope === 'sftp-local') {
      return pathBookmarks['sftp:local'] || []
    }
    if (!baseServerId) return []
    const sftpList = pathBookmarks[`sftp:${baseServerId}`] || []
    const wsList = pathBookmarks[`workspace:${baseServerId}`] || []
    return Array.from(new Set([...sftpList, ...wsList]))
  }, [scope, pathBookmarks, baseServerId])

  const isBookmarked = useCallback(
    (path: string) => {
      if (!path) return false
      return bookmarks.includes(path)
    },
    [bookmarks]
  )

  const addBookmark = useCallback(
    (path: string, customMsgs?: { maxLimitMsg?: string; successMsg?: string }) => {
      if (!path) return false
      if (bookmarks.includes(path)) return false
      if (bookmarks.length >= 50) {
        onToast?.warning?.(customMsgs?.maxLimitMsg || 'Maximum 50 bookmarks allowed')
        return false
      }
      // 远程服务器：addPathBookmark 内部已打通 sibling 同步，此处传入当前 scopeKey
      const ok = addPathBookmarkAction(scopeKey, path)
      if (ok) {
        onToast?.success?.(customMsgs?.successMsg || 'Bookmark added')
      }
      return ok
    },
    [bookmarks, addPathBookmarkAction, scopeKey, onToast]
  )

  const removeBookmark = useCallback(
    (path: string, customMsgs?: { infoMsg?: string }) => {
      if (!path) return
      // 远程服务器：removePathBookmark 内部已打通 sibling 同步，此处传入当前 scopeKey
      removePathBookmarkAction(scopeKey, path)
      onToast?.info?.(customMsgs?.infoMsg || 'Bookmark removed')
    },
    [removePathBookmarkAction, scopeKey, onToast]
  )

  const toggleBookmark = useCallback(
    (path: string, customMsgs?: { maxLimitMsg?: string; successMsg?: string; infoMsg?: string }) => {
      if (!path) return
      if (isBookmarked(path)) {
        removeBookmark(path, customMsgs)
      } else {
        addBookmark(path, customMsgs)
      }
    },
    [isBookmarked, removeBookmark, addBookmark]
  )

  // Sort & Hidden File Selectors
  const sftpLocalSortField = useAppStore((s) => s.sftpLocalSortField)
  const setSftpLocalSortField = useAppStore((s) => s.setSftpLocalSortField)
  const sftpLocalSortOrder = useAppStore((s) => s.sftpLocalSortOrder)
  const setSftpLocalSortOrder = useAppStore((s) => s.setSftpLocalSortOrder)
  const sftpLocalShowHidden = useAppStore((s) => s.sftpLocalShowHidden)
  const setSftpLocalShowHidden = useAppStore((s) => s.setSftpLocalShowHidden)

  const sftpRemoteSortField = useAppStore((s) => s.sftpRemoteSortField)
  const setSftpRemoteSortField = useAppStore((s) => s.setSftpRemoteSortField)
  const sftpRemoteSortOrder = useAppStore((s) => s.sftpRemoteSortOrder)
  const setSftpRemoteSortOrder = useAppStore((s) => s.setSftpRemoteSortOrder)
  const sftpRemoteShowHidden = useAppStore((s) => s.sftpRemoteShowHidden)
  const setSftpRemoteShowHidden = useAppStore((s) => s.setSftpRemoteShowHidden)

  const workspaceFileSortField = useAppStore((s) => s.workspaceFileSortField)
  const setWorkspaceFileSortField = useAppStore((s) => s.setWorkspaceFileSortField)
  const workspaceFileSortDirection = useAppStore((s) => s.workspaceFileSortDirection)
  const setWorkspaceFileSortDirection = useAppStore((s) => s.setWorkspaceFileSortDirection)
  const workspaceFileShowHidden = useAppStore((s) => s.workspaceFileShowHidden)
  const setWorkspaceFileShowHidden = useAppStore((s) => s.setWorkspaceFileShowHidden)

  // Unified resolution
  const sortField = useMemo(() => {
    if (scope === 'sftp-local') return sftpLocalSortField
    if (scope === 'sftp-remote') return sftpRemoteSortField
    return workspaceFileSortField
  }, [scope, sftpLocalSortField, sftpRemoteSortField, workspaceFileSortField])

  const sortOrder = useMemo(() => {
    if (scope === 'sftp-local') return sftpLocalSortOrder
    if (scope === 'sftp-remote') return sftpRemoteSortOrder
    return workspaceFileSortDirection
  }, [scope, sftpLocalSortOrder, sftpRemoteSortOrder, workspaceFileSortDirection])

  const showHidden = useMemo(() => {
    if (scope === 'sftp-local') return sftpLocalShowHidden
    if (scope === 'sftp-remote') return sftpRemoteShowHidden
    return workspaceFileShowHidden
  }, [scope, sftpLocalShowHidden, sftpRemoteShowHidden, workspaceFileShowHidden])

  const setSortField = useCallback(
    (field: any) => {
      if (scope === 'sftp-local') setSftpLocalSortField(field)
      else if (scope === 'sftp-remote') setSftpRemoteSortField(field)
      else setWorkspaceFileSortField(field)
    },
    [scope, setSftpLocalSortField, setSftpRemoteSortField, setWorkspaceFileSortField]
  )

  const setSortOrder = useCallback(
    (order: 'asc' | 'desc') => {
      if (scope === 'sftp-local') setSftpLocalSortOrder(order)
      else if (scope === 'sftp-remote') setSftpRemoteSortOrder(order)
      else setWorkspaceFileSortDirection(order)
    },
    [scope, setSftpLocalSortOrder, setSftpRemoteSortOrder, setWorkspaceFileSortDirection]
  )

  const handleSort = useCallback(
    (field: any) => {
      if (sortField === field) {
        const nextOrder = sortOrder === 'asc' ? 'desc' : 'asc'
        setSortOrder(nextOrder)
      } else {
        setSortField(field)
        setSortOrder('asc')
      }
    },
    [sortField, sortOrder, setSortField, setSortOrder]
  )

  const setShowHidden = useCallback(
    (show: boolean) => {
      if (scope === 'sftp-local') setSftpLocalShowHidden(show)
      else if (scope === 'sftp-remote') setSftpRemoteShowHidden(show)
      else setWorkspaceFileShowHidden(show)
    },
    [scope, setSftpLocalShowHidden, setSftpRemoteShowHidden, setWorkspaceFileShowHidden]
  )

  const toggleShowHidden = useCallback(() => {
    setShowHidden(!showHidden)
  }, [showHidden, setShowHidden])

  return {
    scopeKey,
    bookmarks,
    isBookmarked,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    sortField,
    sortOrder,
    setSortField,
    setSortOrder,
    handleSort,
    showHidden,
    setShowHidden,
    toggleShowHidden,
  }
}
