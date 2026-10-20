import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { SftpBookmarkDropdown } from '../sftp-bookmark-dropdown'

describe('SftpBookmarkDropdown', () => {
  afterEach(cleanup)

  const createProps = () => ({
    currentPath: '/var/log/nginx',
    bookmarks: ['/etc/nginx', '/var/log', '/home/user'],
    onAddBookmark: vi.fn(),
    onRemoveBookmark: vi.fn(),
    onNavigate: vi.fn(),
    disabled: false,
    t: (key: string) => key,
  })

  it('renders split button with bookmark toggle and dropdown trigger', () => {
    const props = createProps()
    render(<SftpBookmarkDropdown {...props} />)

    // 左侧收藏按钮（未收藏状态显示 sftp_add_bookmark）
    const toggleBtn = screen.getByRole('button', { name: 'sftp_add_bookmark' })
    expect(toggleBtn).toBeTruthy()

    // 右侧下拉展开按钮（显示 sftp_bookmarks）
    const dropdownBtn = screen.getByRole('button', { name: 'sftp_bookmarks' })
    expect(dropdownBtn).toBeTruthy()
  })

  it('directly triggers onAddBookmark when clicking bookmark icon for unbookmarked path', () => {
    const props = createProps()
    render(<SftpBookmarkDropdown {...props} />)

    const toggleBtn = screen.getByRole('button', { name: 'sftp_add_bookmark' })
    fireEvent.click(toggleBtn)

    expect(props.onAddBookmark).toHaveBeenCalledTimes(1)
    expect(props.onAddBookmark).toHaveBeenCalledWith('/var/log/nginx')
    expect(props.onRemoveBookmark).not.toHaveBeenCalled()
  })

  it('directly triggers onRemoveBookmark when clicking bookmark icon for already bookmarked path', () => {
    const props = {
      ...createProps(),
      currentPath: '/etc/nginx', // 已经在 bookmarks 中
    }
    render(<SftpBookmarkDropdown {...props} />)

    const toggleBtn = screen.getByRole('button', { name: 'sftp_remove_current_bookmark' })
    fireEvent.click(toggleBtn)

    expect(props.onRemoveBookmark).toHaveBeenCalledTimes(1)
    expect(props.onRemoveBookmark).toHaveBeenCalledWith('/etc/nginx')
    expect(props.onAddBookmark).not.toHaveBeenCalled()
  })

  it('allows adding current path from dropdown menu when not bookmarked', () => {
    const props = { ...createProps(), open: true }
    render(<SftpBookmarkDropdown {...props} />)

    const addBtn = screen.getByText('sftp_add_bookmark')
    fireEvent.click(addBtn)
    expect(props.onAddBookmark).toHaveBeenCalledWith('/var/log/nginx')
  })

  it('allows removing current path from dropdown menu when already bookmarked', () => {
    const props = {
      ...createProps(),
      currentPath: '/etc/nginx',
      open: true,
    }
    render(<SftpBookmarkDropdown {...props} />)

    const removeBtn = screen.getByText('sftp_remove_current_bookmark')
    fireEvent.click(removeBtn)
    expect(props.onRemoveBookmark).toHaveBeenCalledWith('/etc/nginx')
  })

  it('navigates to path when a bookmark item is clicked in dropdown', () => {
    const props = { ...createProps(), open: true }
    render(<SftpBookmarkDropdown {...props} />)

    const item = screen.getByText('/var/log')
    fireEvent.click(item)
    expect(props.onNavigate).toHaveBeenCalledWith('/var/log')
  })

  it('removes bookmark when clicking the trash button in dropdown', () => {
    const props = { ...createProps(), open: true }
    render(<SftpBookmarkDropdown {...props} />)

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete bookmark' })
    expect(deleteButtons.length).toBe(3)
    fireEvent.click(deleteButtons[1]) // delete '/var/log'
    expect(props.onRemoveBookmark).toHaveBeenCalledWith('/var/log')
  })

  it('renders empty placeholder when there are no bookmarks', () => {
    const props = {
      ...createProps(),
      bookmarks: [],
      open: true,
    }
    render(<SftpBookmarkDropdown {...props} />)

    expect(screen.getByText('sftp_no_bookmarks')).toBeTruthy()
  })
})
