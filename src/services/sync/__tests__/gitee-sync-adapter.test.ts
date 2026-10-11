import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  verifyGiteeToken,
  ensureBackupRepo,
  uploadBackupFile,
  downloadBackupFile,
  getBackupHistory,
} from '../gitee-sync-adapter'

describe('Gitee Sync Adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects empty token in verifyGiteeToken', async () => {
    const res = await verifyGiteeToken('')
    expect(res.success).toBe(false)
    expect(res.error).toContain('请输入有效的 Gitee 私人令牌')
  })

  it('handles successful verifyGiteeToken response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        id: 12345,
        login: 'Tom-shushu',
        name: 'Tom',
        avatar_url: 'https://gitee.com/avatar.png',
      }),
    } as unknown as Response)

    const res = await verifyGiteeToken('valid_token')
    expect(res.success).toBe(true)
    expect(res.user?.login).toBe('Tom-shushu')
    expect(res.user?.avatar_url).toBe('https://gitee.com/avatar.png')
  })

  it('handles 401 unauthorized in verifyGiteeToken', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    } as unknown as Response)

    const res = await verifyGiteeToken('invalid_token')
    expect(res.success).toBe(false)
    expect(res.error).toContain('令牌无效')
  })

  it('downloads and decodes backup file correctly', async () => {
    const plaintext = '{"hello":"world"}'
    const base64 = btoa(unescape(encodeURIComponent(plaintext)))

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        content: base64,
        sha: 'abc123sha',
      }),
    } as unknown as Response)

    const res = await downloadBackupFile('token', 'owner')
    expect(res.success).toBe(true)
    expect(res.content).toBe(plaintext)
  })

  it('handles 404 when downloading non-existent backup', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    } as unknown as Response)

    const res = await downloadBackupFile('token', 'owner')
    expect(res.success).toBe(false)
    expect(res.error).toContain('云端暂未发现备份文件')
  })
})
