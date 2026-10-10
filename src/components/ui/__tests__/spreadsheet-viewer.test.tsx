import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SpreadsheetViewer } from '../spreadsheet-viewer'

// Mock xlsx
vi.mock('xlsx', () => ({
  read: vi.fn().mockReturnValue({
    SheetNames: ['Sheet1', 'Sheet2'],
    Sheets: {
      Sheet1: {},
      Sheet2: {},
    },
  }),
  utils: {
    sheet_to_json: vi.fn().mockReturnValue([
      ['ID', 'Name', 'Role'],
      [1, 'Alice', 'Engineer'],
      [2, 'Bob', 'Designer'],
    ]),
  },
}))

describe('SpreadsheetViewer', () => {
  it('renders spreadsheet headers and cells correctly', async () => {
    const fakeData = new Uint8Array([1, 2, 3, 4])
    const { container } = render(<SpreadsheetViewer data={fakeData} fileName="test.xlsx" />)

    await waitFor(() => {
      expect(screen.getByText('test.xlsx')).toBeDefined()
      expect(screen.getByText('Alice')).toBeDefined()
      expect(screen.getByText('Designer')).toBeDefined()
      expect(container.querySelector('table')).not.toBeNull()
    })
  })

  it('renders multiple sheet tabs when more than 1 sheet exists', async () => {
    const fakeData = new Uint8Array([1, 2, 3, 4])
    render(<SpreadsheetViewer data={fakeData} />)

    await waitFor(() => {
      expect(screen.getByText('Sheet1')).toBeDefined()
      expect(screen.getByText('Sheet2')).toBeDefined()
    })
  })
})
