import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  verifyGitHubToken,
  downloadBackupFile,
} from '../github-sync-adapter'

describe('GitHub Sync Adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects empty token in verifyGitHubToken', async () => {
    const res = await verifyGitHubToken('')
    expect(res.success).toBe(false)
    expect(res.error).toContain('请输入有效的 GitHub 访问令牌')
  })

  it('handles successful verifyGitHubToken response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        id: 99999,
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'https://github.com/octocat.png',
      }),
    } as unknown as Response)

    const res = await verifyGitHubToken('ghp_test_token')
    expect(res.success).toBe(true)
    expect(res.user?.login).toBe('octocat')
    expect(res.user?.name).toBe('The Octocat')
    expect(res.user?.avatar_url).toBe('https://github.com/octocat.png')
  })

  it('handles 401 unauthorized in verifyGitHubToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    } as unknown as Response)

    const res = await verifyGitHubToken('invalid_token')
    expect(res.success).toBe(false)
    expect(res.error).toContain('令牌无效或已过期')
  })

  it('handles 403 forbidden with repo scope advice', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
    } as unknown as Response)

    const res = await verifyGitHubToken('limited_token')
    expect(res.success).toBe(false)
    expect(res.error).toContain('repo 权限')
  })

  it('downloads and decodes backup file correctly from GitHub', async () => {
    const plaintext = '{"provider":"github","servers":[]}'
    const base64 = btoa(unescape(encodeURIComponent(plaintext)))

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        content: base64,
        sha: 'github_file_sha_123',
      }),
    } as unknown as Response)

    const res = await downloadBackupFile('token', 'octocat')
    expect(res.success).toBe(true)
    expect(res.content).toBe(plaintext)
  })

  it('handles 404 when downloading non-existent backup from GitHub', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    } as unknown as Response)

    const res = await downloadBackupFile('token', 'octocat')
    expect(res.success).toBe(false)
    expect(res.error).toContain('云端暂未发现备份文件')
  })
})
