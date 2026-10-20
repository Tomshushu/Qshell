import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { FileToolbar } from '../file-toolbar'

describe('FileToolbar with Bookmark Dropdown', () => {
  afterEach(cleanup)

  const createProps = () => ({
    currentPath: '/var/log/nginx',
    onNavigateTo: vi.fn(),
    bookmarks: ['/etc/nginx', '/var/log'],
    onAddBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    onRefresh: vi.fn(),
    transferLoading: null,
    onNativeUpload: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    showNewItem: false,
    newItemType: 'file' as const,
    newItemName: '',
    setNewItemName: vi.fn(),
    onNewItemConfirm: vi.fn(),
    onNewItemCancel: vi.fn(),
    t: (key: string) => key,
  })

  it('renders split bookmark dropdown button and triggers add on click', () => {
    const props = createProps()
    render(<FileToolbar {...props} />)

    // 左侧收藏按钮（当前未收藏，点击立即收藏）
    const addBookmarkBtn = screen.getByRole('button', { name: 'sftp_add_bookmark' })
    expect(addBookmarkBtn).toBeTruthy()

    fireEvent.click(addBookmarkBtn)
    expect(props.onAddBookmark).toHaveBeenCalledWith('/var/log/nginx')
  })

  it('triggers remove on click when current path is already bookmarked', () => {
    const props = {
      ...createProps(),
      currentPath: '/etc/nginx', // 已在 bookmarks 中
    }
    render(<FileToolbar {...props} />)

    const removeBookmarkBtn = screen.getByRole('button', { name: 'sftp_remove_current_bookmark' })
    expect(removeBookmarkBtn).toBeTruthy()

    fireEvent.click(removeBookmarkBtn)
    expect(props.onRemoveBookmark).toHaveBeenCalledWith('/etc/nginx')
  })
})
