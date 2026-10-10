import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CodeEditor } from '../code-editor'

describe('CodeEditor language detection and rendering', () => {
  it('renders Rust code with syntax highlighting without crashing', () => {
    const rustCode = 'fn main() {\n    println!("Hello, Rust!");\n}'
    const { container } = render(<CodeEditor value={rustCode} fileName="main.rs" />)
    expect(container.querySelector('.token.keyword')).not.toBeNull()
  })

  it('renders Go code with syntax highlighting', () => {
    const goCode = 'package main\n\nfunc main() {\n    println("Hello, Go!")\n}'
    const { container } = render(<CodeEditor value={goCode} fileName="main.go" />)
    expect(container.querySelector('.token.keyword')).not.toBeNull()
  })

  it('renders Dockerfile with syntax highlighting', () => {
    const dockerCode = 'FROM node:20\nWORKDIR /app\nCOPY . .\nCMD ["npm", "start"]'
    const { container } = render(<CodeEditor value={dockerCode} fileName="Dockerfile" />)
    expect(container.querySelector('.token.keyword')).not.toBeNull()
  })

  it('renders Python code correctly', () => {
    const pyCode = 'def greet(name: str):\n    return f"Hello, {name}!"'
    const { container } = render(<CodeEditor value={pyCode} fileName="app.py" />)
    expect(container.querySelector('.token.keyword')).not.toBeNull()
  })
})
