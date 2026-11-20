import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  isTauri: true,
  appDataDir: 'C:\\Users\\demo\\AppData\\Roaming\\com.qshell.app',
  existing: new Set<string>(),
  mkdirMock: vi.fn(async (dir: string) => {
    mockState.existing.add(dir)
  }),
}))

vi.mock('@/services/api', () => ({
  get isTauri() {
    return mockState.isTauri
  },
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => mockState.appDataDir),
  join: vi.fn(async (...parts: string[]) => {
    const sep = mockState.appDataDir.includes('\\') ? '\\' : '/'
    return parts
      .map((p, idx) => (idx === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
      .filter(Boolean)
      .join(sep)
  }),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (dir: string) => mockState.existing.has(dir)),
  mkdir: mockState.mkdirMock,
}))

import {
  DEFAULT_EXPORTS_SUBDIR,
  DEFAULT_RECORDINGS_SUBDIR,
  buildDefaultSavePath,
  resolveAppDataSubdir,
  resolveRecordingDirectory,
} from '../app-paths'

describe('app-paths', () => {
  beforeEach(() => {
    mockState.isTauri = true
    mockState.appDataDir = 'C:\\Users\\demo\\AppData\\Roaming\\com.qshell.app'
    mockState.existing.clear()
    mockState.mkdirMock.mockClear()
  })

  it('defaults recordings directory to appDataDir/recordings with Windows separator and creates it', async () => {
    const dir = await resolveRecordingDirectory('')
    expect(dir).toBe(`C:\\Users\\demo\\AppData\\Roaming\\com.qshell.app\\${DEFAULT_RECORDINGS_SUBDIR}`)
    expect(mockState.mkdirMock).toHaveBeenCalledWith(dir, { recursive: true })
  })

  it('handles POSIX appDataDir paths on macOS/Linux', async () => {
    mockState.appDataDir = '/Users/demo/Library/Application Support/com.qshell.app'
    const dir = await resolveAppDataSubdir(DEFAULT_RECORDINGS_SUBDIR)
    expect(dir).toBe('/Users/demo/Library/Application Support/com.qshell.app/recordings')
    const savePath = await buildDefaultSavePath('session.log', {
      fallbackSubdir: DEFAULT_EXPORTS_SUBDIR,
    })
    expect(savePath).toBe('/Users/demo/Library/Application Support/com.qshell.app/exports/session.log')
  })

  it('prefers configured directory over default appDataDir', async () => {
    const dir = await resolveRecordingDirectory('D:\\Logs\\Qshell')
    expect(dir).toBe('D:\\Logs\\Qshell')
  })

  it('returns empty/bare filename outside Tauri', async () => {
    mockState.isTauri = false
    expect(await resolveRecordingDirectory('')).toBe('')
    expect(await buildDefaultSavePath('audit.log')).toBe('audit.log')
  })
})
