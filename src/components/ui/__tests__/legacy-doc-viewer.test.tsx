import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LegacyDocViewer } from '../legacy-doc-viewer'

describe('LegacyDocViewer', () => {
  it('renders extracted paragraphs and format notice', () => {
    // Construct a buffer with UTF-16LE text: "Hello World Document Text"
    const text = "Hello World Document Text"
    const buffer = new Uint8Array(text.length * 2)
    for (let i = 0; i < text.length; i++) {
      buffer[i * 2] = text.charCodeAt(i)
      buffer[i * 2 + 1] = 0
    }

    render(<LegacyDocViewer data={buffer} fileName="old-resume.doc" />)

    expect(screen.getByText('旧版 Word 97-2003 (.doc) 正文文本速览')).toBeDefined()
    expect(screen.getByText('old-resume.doc')).toBeDefined()
    expect(screen.getByText('Hello World Document Text')).toBeDefined()
  })

  it('handles empty buffer gracefully', () => {
    render(<LegacyDocViewer data={null} />)
    expect(screen.getByText('未能在此 .doc 二进制文件中提取到有效文本段落')).toBeDefined()
  })
})
