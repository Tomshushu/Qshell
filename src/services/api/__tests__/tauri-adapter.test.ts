import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Server } from '@/types'

/**
 * Tauri 适配器的 IPC 契约测试。
 *
 * 只断言「前端发了什么」——命令名与 payload 形状。
 * 一旦有人改了参数名/漏传字段，这里会先红，避免前后端静默失效。
 *
 * 注：不触碰任何生产代码，靠 mock @tauri-apps/api/core 的 invoke 实现。
 */

vi.mock('@tauri-apps/api/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/core')>()
  return { ...actual, invoke: vi.fn() }
})

// ssh.connect 会先 ensureSshConnectionListener()，需要拦截事件订阅
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

import { invoke } from '@tauri-apps/api/core'
import { tauriAdapter } from '../tauri-adapter'

const invokeMock = vi.mocked(invoke)

function lastArgs(): Record<string, unknown> {
  const call = invokeMock.mock.calls.at(-1)
  return (call?.[1] ?? {}) as Record<string, unknown>
}

describe('tauri-adapter IPC contract', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  describe('servers', () => {
    it('list calls servers_list without args and parses the JSON string', async () => {
      invokeMock.mockResolvedValue(JSON.stringify([{ id: 's1', name: 'S1' }]))

      const list = await tauriAdapter.servers.list()

      expect(invokeMock).toHaveBeenCalledWith('servers_list', undefined)
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('s1')
    })

    it('add serializes the server object to a JSON string', async () => {
      invokeMock.mockResolvedValue({ success: true })
      const server = { id: 's1', name: 'S1' } as unknown as Server

      await tauriAdapter.servers.add(server)

      expect(invokeMock).toHaveBeenCalledWith('servers_add', {
        server: JSON.stringify(server),
      })
    })

    it('delete passes the id verbatim', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.servers.delete('s1')

      expect(invokeMock).toHaveBeenCalledWith('servers_delete', { id: 's1' })
    })
  })

  describe('ssh', () => {
    it('connect sends serverId to ssh_connect', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.ssh.connect('s1')

      expect(invokeMock).toHaveBeenCalledWith('ssh_connect', { serverId: 's1' })
    })

    it('execute passes the command verbatim (no shell escaping on this layer)', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.ssh.execute('s1', 'docker ps -a | head -5')

      expect(invokeMock).toHaveBeenCalledWith('ssh_execute', {
        serverId: 's1',
        command: 'docker ps -a | head -5',
      })
    })

    it('getState maps the raw payload to the result shape', async () => {
      invokeMock.mockResolvedValue({ state: 'connected', generation: 3 })

      const r = await tauriAdapter.ssh.getState('s1')

      expect(invokeMock).toHaveBeenCalledWith('ssh_get_state', { serverId: 's1' })
      expect(r.generation).toBe(3)
    })

    it('deleteKnownHost sends host/port/keyType together', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.ssh.deleteKnownHost('10.0.0.1', 22, 'ssh-ed25519')

      expect(invokeMock).toHaveBeenCalledWith('ssh_delete_known_host', {
        host: '10.0.0.1',
        port: 22,
        keyType: 'ssh-ed25519',
      })
    })
  })

  describe('files', () => {
    it('list maps the path argument to dirPath', async () => {
      invokeMock.mockResolvedValue(JSON.stringify([]))

      await tauriAdapter.files.list('s1', '/var/log')

      expect(invokeMock).toHaveBeenCalledWith('files_list', {
        serverId: 's1',
        dirPath: '/var/log',
      })
    })

    it('upload defaults concurrency and skipExisting to null', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.files.upload('s1', '/tmp', 'file')

      expect(invokeMock).toHaveBeenCalledWith('files_upload', {
        serverId: 's1',
        remoteDir: '/tmp',
        uploadType: 'file',
        concurrency: null,
        skipExisting: null,
      })
    })

    it('download defaults concurrency and skipExisting to null', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.files.download('s1', '/remote/a', '/local/a')

      expect(invokeMock).toHaveBeenCalledWith('files_download', {
        serverId: 's1',
        remotePath: '/remote/a',
        localDest: '/local/a',
        concurrency: null,
        skipExisting: null,
      })
    })

    it('resumeUpload forwards every resume parameter', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.files.resumeUpload(
        's1',
        'C:/local/a.bin',
        '/remote/a.bin',
        '/remote/a.bin.tmp',
        1024,
        'transfer-1',
        2048,
      )

      expect(invokeMock).toHaveBeenCalledWith('files_resume_upload', {
        serverId: 's1',
        localPath: 'C:/local/a.bin',
        remotePath: '/remote/a.bin',
        tmpRemotePath: '/remote/a.bin.tmp',
        offset: 1024,
        transferId: 'transfer-1',
        expectedSourceSize: 2048,
      })
    })

    it('resumeUpload maps an omitted expectedSourceSize to null', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.files.resumeUpload('s1', 'l', 'r', 't', 0, 'tid')

      expect(lastArgs().expectedSourceSize).toBeNull()
    })
  })

  describe('docker', () => {
    it('ps calls docker_ps and parses the JSON payload', async () => {
      invokeMock.mockResolvedValue(JSON.stringify([{ ID: 'abc123' }]))

      const list = await tauriAdapter.docker.ps('s1')

      expect(invokeMock).toHaveBeenCalledWith('docker_ps', { serverId: 's1' })
      expect(list).toHaveLength(1)
    })

    it('stop sends both serverId and containerId', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.docker.stop('s1', 'abc123')

      expect(invokeMock).toHaveBeenCalledWith('docker_stop', {
        serverId: 's1',
        containerId: 'abc123',
      })
    })
  })

  describe('error handling', () => {
    it('wraps a string rejection into an Error that keeps the cause', async () => {
      invokeMock.mockRejectedValue('backend exploded')

      await expect(tauriAdapter.ssh.disconnect('s1')).rejects.toThrow('backend exploded')

      try {
        await tauriAdapter.ssh.disconnect('s1')
      } catch (e) {
        expect((e as Error).cause).toBe('backend exploded')
      }
    })

    it('throws a descriptive error when the backend returns non-JSON', async () => {
      invokeMock.mockResolvedValue('Error: cannot connect to the docker daemon')
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(tauriAdapter.docker.ps('s1')).rejects.toThrow(/JSON\.parse 失败/)
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('server normalization', () => {
    /** 通过 servers.list 间接验证 normalizeServer（模块内私有函数，不为测试额外暴露） */
    async function normalizeOne(raw: Record<string, unknown>): Promise<Server> {
      invokeMock.mockResolvedValue(JSON.stringify([raw]))
      const [server] = await tauriAdapter.servers.list()
      return server as Server
    }

    it('maps snake_case fields to camelCase', async () => {
      const s = await normalizeOne({
        id: 's1',
        name: 'S1',
        auth_type: 'privateKey',
        private_key_path: '/home/u/.ssh/id_ed25519',
        target_type: 'windows',
        rdp_port: 3389,
        created_at: 111,
        updated_at: 222,
      })

      expect(s.authType).toBe('privateKey')
      expect(s.privateKeyPath).toBe('/home/u/.ssh/id_ed25519')
      expect(s.targetType).toBe('windows')
      expect(s.rdpPort).toBe(3389)
      expect(s.createdAt).toBe(111)
      expect(s.updatedAt).toBe(222)
    })

    it('keeps camelCase payload unchanged', async () => {
      const s = await normalizeOne({
        id: 's1',
        name: 'S1',
        authType: 'sshAgent',
        privateKeyPath: '/k',
        targetType: 'unix',
        rdpPort: 3390,
      })

      expect(s.authType).toBe('sshAgent')
      expect(s.privateKeyPath).toBe('/k')
      expect(s.targetType).toBe('unix')
      expect(s.rdpPort).toBe(3390)
    })

    it('parses tags returned as a JSON string', async () => {
      const s = await normalizeOne({ id: 's1', name: 'S1', tags: '["prod","db"]' })
      expect(s.tags).toEqual(['prod', 'db'])
    })

    it('falls back to an empty tag list for malformed tags JSON', async () => {
      const s = await normalizeOne({ id: 's1', name: 'S1', tags: 'not-json' })
      expect(s.tags).toEqual([])
    })

    it('falls back to the single protocol when protocols JSON is malformed', async () => {
      const s = await normalizeOne({
        id: 's1',
        name: 'S1',
        protocols: 'oops',
        protocol: 'telnet',
      })
      expect(s.protocols).toEqual(['telnet'])
    })

    it('keeps rdpPort 0 instead of replacing it with a default', async () => {
      // 实现特意用 !== undefined 判断，避免 `||` 把 0 当成空值
      const s = await normalizeOne({ id: 's1', name: 'S1', rdp_port: 0 })
      expect(s.rdpPort).toBe(0)
    })

    it('applies sane defaults for missing optional fields', async () => {
      const s = await normalizeOne({ id: 's1', name: 'S1' })

      expect(s.authType).toBe('password')
      expect(s.privateKeyPath).toBe('')
      expect(s.targetType).toBe('linux')
      expect(s.protocol).toBe('ssh')
      expect(s.protocols).toEqual(['ssh'])
      expect(s.tags).toEqual([])
      expect(s.bmcPort).toBe(443)
      expect(s.osType).toBe('')
      expect(s.osInfo).toBe('')
      expect(s.groupId).toBeNull()
    })
  })
})
