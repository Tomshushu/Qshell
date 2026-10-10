import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogViewer } from '../log-viewer'

describe('LogViewer', () => {
  it('renders log file name, line count, and toolbar correctly', async () => {
    const sampleLog = '2026-09-23 12:00:00 [INFO] Server started\n2026-09-23 12:00:01 [WARN] Slow response\n2026-09-23 12:00:02 [ERROR] Database timeout'

    render(<LogViewer data={sampleLog} fileName="poetry.log" />)

    expect(screen.getByText('poetry.log')).not.toBeNull()
    expect(screen.getByText(/3 行/)).not.toBeNull()
    expect(screen.getByText('虚拟滚动 100% 全量')).not.toBeNull()
    expect(screen.getByPlaceholderText('搜索日志...')).not.toBeNull()
  })

  it('renders empty log state when data is empty', async () => {
    render(<LogViewer data="" fileName="empty.log" />)

    expect(screen.getByText('日志文件为空')).not.toBeNull()
  })

  it('renders format button for JSON files and supports JSON preview', async () => {
    const rawJson = '{"name":"qshell","version":1}'
    render(<LogViewer data={rawJson} fileName="package.json" />)

    expect(screen.getByText('package.json')).not.toBeNull()
    expect(screen.getByText('格式化')).not.toBeNull()
  })
})
