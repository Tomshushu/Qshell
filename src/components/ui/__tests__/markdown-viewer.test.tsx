import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownViewer } from '../markdown-viewer'

describe('MarkdownViewer', () => {
  it('renders markdown headers and bold text correctly', () => {
    const md = '# Hello World\n\nThis is **bold** text.'
    const { container } = render(<MarkdownViewer content={md} />)

    const h1 = container.querySelector('h1')
    expect(h1).not.toBeNull()
    expect(h1?.textContent).toBe('Hello World')

    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong?.textContent).toBe('bold')
  })

  it('renders tables and code blocks correctly', () => {
    const md = '```ts\nconst x = 42;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |'
    const { container } = render(<MarkdownViewer content={md} />)

    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toContain('const x = 42;')

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('th').length).toBe(2)
    expect(container.querySelectorAll('td').length).toBe(2)
  })

  it('handles empty content gracefully', () => {
    const { container } = render(<MarkdownViewer content="" />)
    expect(container.firstChild).not.toBeNull()
  })
})
