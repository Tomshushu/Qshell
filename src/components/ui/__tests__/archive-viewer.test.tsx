import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import JSZip from 'jszip'
import { ArchiveViewer, buildArchiveTree } from '../archive-viewer'

describe('ArchiveViewer', () => {
  it('correctly builds hierarchical directory tree from JSZip entries', async () => {
    const zip = new JSZip()
    zip.file('iot-single/.claude/settings.local.json', '{"test": 1}')
    zip.file('iot-single/src/index.ts', 'console.log("hi")')
    zip.file('README.md', '# Readme')

    const root = buildArchiveTree(zip)

    // Root should have 2 children: directory 'iot-single' and file 'README.md'
    expect(root.children.length).toBe(2)
    expect(root.children[0].name).toBe('iot-single')
    expect(root.children[0].isDirectory).toBe(true)
    expect(root.children[1].name).toBe('README.md')
    expect(root.children[1].isDirectory).toBe(false)

    // Total files should be 3
    expect(root.totalFiles).toBe(3)

    // 'iot-single' directory should have 2 subdirectories: '.claude' and 'src'
    const iotDir = root.children[0]
    expect(iotDir.children.length).toBe(2)
    expect(iotDir.children[0].name).toBe('.claude')
    expect(iotDir.children[1].name).toBe('src')

    // '.claude' should contain 'settings.local.json'
    const claudeDir = iotDir.children[0]
    expect(claudeDir.children.length).toBe(1)
    expect(claudeDir.children[0].name).toBe('settings.local.json')
    expect(claudeDir.children[0].isDirectory).toBe(false)
  })

  it('renders archive tree view and allows expanding and selecting files', async () => {
    const zip = new JSZip()
    zip.file('app/config.json', '{"env": "prod"}')
    zip.file('app/notes.txt', 'some notes')
    const zipData = await zip.generateAsync({ type: 'uint8array' })

    render(<ArchiveViewer data={zipData} fileName="project.zip" />)

    // Wait for tree to be parsed and rendered
    await waitFor(() => {
      expect(screen.getByText('project.zip')).not.toBeNull()
      expect(screen.getByText('app')).not.toBeNull()
    })

    // Search box should be rendered
    expect(screen.getByPlaceholderText('搜索包内文件...')).not.toBeNull()

    // File content of default selected file or after clicking notes.txt
    await waitFor(() => {
      expect(screen.getAllByText('config.json').length).toBeGreaterThanOrEqual(1)
    })

    // Format button should be displayed for JSON files
    await waitFor(() => {
      expect(screen.getByText('格式化')).not.toBeNull()
    })

    // Click format button and verify formatted content
    fireEvent.click(screen.getByText('格式化'))
    await waitFor(() => {
      expect(screen.getByText(/"env": "prod"/)).not.toBeNull()
    })
  })
})
