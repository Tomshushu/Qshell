import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { DocxViewer } from '../docx-viewer'

// Mock docx-preview
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn().mockImplementation((_data, container) => {
    const div = document.createElement('div')
    div.className = 'docx-mock-content'
    div.textContent = 'Rendered Docx Page'
    container.appendChild(div)
    return Promise.resolve()
  }),
}))

describe('DocxViewer', () => {
  it('renders docx content successfully when data is provided', async () => {
    const fakeData = new Uint8Array([80, 75, 3, 4]) // PK zip magic header
    const { container } = render(<DocxViewer data={fakeData} />)

    await waitFor(() => {
      const mockElement = container.querySelector('.docx-mock-content')
      expect(mockElement).not.toBeNull()
      expect(mockElement?.textContent).toBe('Rendered Docx Page')
    })
  })

  it('renders gracefully when data is undefined', () => {
    const { container } = render(<DocxViewer data={undefined} />)
    const root = container.querySelector('.docx-preview-root')
    expect(root).not.toBeNull()
  })
})
