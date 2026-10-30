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

  describe('serial', () => {
    it('listPorts calls serial_list_ports without args', async () => {
      invokeMock.mockResolvedValue([])

      await tauriAdapter.serial.listPorts()

      expect(invokeMock).toHaveBeenCalledWith('serial_list_ports', undefined)
    })

    it('testPort fills the serial defaults', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.serial.testPort('COM3')

      expect(invokeMock).toHaveBeenCalledWith('serial_test_port', {
        portName: 'COM3',
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      })
    })

    it('createShell passes port config together with dtr/rts and encoding defaults', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.serial.createShell('s1', 'COM3')

      expect(invokeMock).toHaveBeenCalledWith(
        'serial_create_shell',
        expect.objectContaining({
          serverId: 's1',
          portName: 'COM3',
          baudRate: 115200,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none',
          dtr: true,
          rts: true,
          encoding: 'utf-8',
        }),
      )
    })
  })

  describe('rdp', () => {
    it('launch sends null for every omitted option', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.rdp.launch({ serverId: 's1' } as never)

      expect(invokeMock).toHaveBeenCalledWith('rdp_launch', {
        serverId: 's1',
        rdpPort: null,
        width: null,
        height: null,
        fullscreen: null,
        colorDepth: null,
      })
    })

    it('launch forwards explicit options', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.rdp.launch({
        serverId: 's1',
        rdpPort: 3389,
        width: 1920,
        height: 1080,
        fullscreen: true,
        colorDepth: 32,
      } as never)

      expect(invokeMock).toHaveBeenCalledWith('rdp_launch', {
        serverId: 's1',
        rdpPort: 3389,
        width: 1920,
        height: 1080,
        fullscreen: true,
        colorDepth: 32,
      })
    })
  })

  describe('bmc', () => {
    it('powerAction sends serverId and action', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.bmc.powerAction('s1', 'on' as never)

      expect(invokeMock).toHaveBeenCalledWith('bmc_power_action', {
        serverId: 's1',
        action: 'on',
      })
    })

    it('setIdentifyLed sends the boolean flag as "on"', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.bmc.setIdentifyLed('s1', true)

      expect(invokeMock).toHaveBeenCalledWith('bmc_set_identify_led', {
        serverId: 's1',
        on: true,
      })
    })
  })

  describe('portForward', () => {
    it('list with no server maps to null', async () => {
      invokeMock.mockResolvedValue([])

      await tauriAdapter.portForward.list()

      expect(invokeMock).toHaveBeenCalledWith('port_forward_list', { serverId: null })
    })

    it('list forwards an explicit serverId', async () => {
      invokeMock.mockResolvedValue([])

      await tauriAdapter.portForward.list('s1')

      expect(invokeMock).toHaveBeenCalledWith('port_forward_list', { serverId: 's1' })
    })

    it('add wraps the spec object', async () => {
      invokeMock.mockResolvedValue({ success: true })
      const spec = { serverId: 's1', localPort: 8080 }

      await tauriAdapter.portForward.add(spec as never)

      expect(invokeMock).toHaveBeenCalledWith('port_forward_add', { spec })
    })

    it('stop and restart use forwardId', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.portForward.stop('f1')
      expect(invokeMock).toHaveBeenCalledWith('port_forward_stop', { forwardId: 'f1' })

      await tauriAdapter.portForward.restart('f1')
      expect(invokeMock).toHaveBeenCalledWith('port_forward_restart', { forwardId: 'f1' })
    })

    it('stopAll uses serverId', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.portForward.stopAll('s1')

      expect(invokeMock).toHaveBeenCalledWith('port_forward_stop_all', { serverId: 's1' })
    })
  })

  describe('serverGroups', () => {
    it('list maps snake_case parent_id and timestamps', async () => {
      invokeMock.mockResolvedValue(
        JSON.stringify([{ id: 'g1', name: 'G1', parent_id: 'p1', created_at: 5 }]),
      )

      const [g] = await tauriAdapter.serverGroups.list()

      expect(invokeMock).toHaveBeenCalledWith('server_groups_list', undefined)
      expect(g.parentId).toBe('p1')
      expect(g.createdAt).toBe(5)
    })

    it('add serializes the group and omits a missing id', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.serverGroups.add({ name: 'G1', parentId: null } as never)

      expect(invokeMock).toHaveBeenCalledWith('server_groups_add', {
        group: JSON.stringify({ name: 'G1', parentId: null }),
      })
    })

    it('update serializes only the provided fields', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.serverGroups.update('g1', { name: 'Renamed' } as never)

      expect(invokeMock).toHaveBeenCalledWith('server_groups_update', {
        id: 'g1',
        updates: JSON.stringify({ name: 'Renamed' }),
      })
    })

    it('delete passes the id', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.serverGroups.delete('g1')

      expect(invokeMock).toHaveBeenCalledWith('server_groups_delete', { id: 'g1' })
    })
  })

  describe('telnet', () => {
    it('createShell sends host/port/size and defaults timeout to null', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.telnet.createShell('s1', '10.0.0.1', 23, 120, 40)

      expect(invokeMock).toHaveBeenCalledWith('telnet_create_shell', {
        serverId: 's1',
        host: '10.0.0.1',
        port: 23,
        cols: 120,
        rows: 40,
        timeoutSecs: null,
        encoding: 'utf-8',
      })
    })
  })

  describe('sshKeys', () => {
    it('list parses JSON and listForSync uses its own command', async () => {
      invokeMock.mockResolvedValue(JSON.stringify([{ id: 'k1' }]))
      await tauriAdapter.sshKeys.list()
      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_list', undefined)

      invokeMock.mockResolvedValue(JSON.stringify([]))
      await tauriAdapter.sshKeys.listForSync!()
      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_list_for_sync', undefined)
    })

    it('add serializes the key input', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.sshKeys.add({ name: 'k1' } as never)

      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_add', {
        key: JSON.stringify({ name: 'k1' }),
      })
    })

    it('update and delete pass id plus serialized updates', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.sshKeys.update('k1', { name: 'k2' } as never)
      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_update', {
        id: 'k1',
        updates: JSON.stringify({ name: 'k2' }),
      })

      await tauriAdapter.sshKeys.delete('k1')
      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_delete', { id: 'k1' })
    })

    it('readFileContent passes the path', async () => {
      invokeMock.mockResolvedValue('content')

      await tauriAdapter.sshKeys.readFileContent('/home/u/.ssh/id_ed25519')

      expect(invokeMock).toHaveBeenCalledWith('ssh_keys_read_file_content', {
        path: '/home/u/.ssh/id_ed25519',
      })
    })
  })

  describe('tags', () => {
    it('list maps rows to plain names', async () => {
      invokeMock.mockResolvedValue([{ name: 'prod' }, { name: 'db' }])

      const names = await tauriAdapter.tags!.list()

      expect(invokeMock).toHaveBeenCalledWith('tags_list', undefined)
      expect(names).toEqual(['prod', 'db'])
    })

    it('create returns the created name', async () => {
      invokeMock.mockResolvedValue({ name: 'new-tag' })

      const name = await tauriAdapter.tags!.create('new-tag')

      expect(invokeMock).toHaveBeenCalledWith('tags_create', { name: 'new-tag' })
      expect(name).toBe('new-tag')
    })

    it('rename sends both names', async () => {
      invokeMock.mockResolvedValue(undefined)

      await tauriAdapter.tags!.rename('old', 'new')

      expect(invokeMock).toHaveBeenCalledWith('tags_rename', { oldName: 'old', newName: 'new' })
    })

    it('listAll reuses tags_list but keeps raw rows', async () => {
      invokeMock.mockResolvedValue([{ name: 'prod', created_at: 1 }])

      const rows = await tauriAdapter.tags!.listAll!()

      expect(invokeMock).toHaveBeenCalledWith('tags_list', undefined)
      expect(rows).toHaveLength(1)
    })
  })

  describe('metrics', () => {
    it('collect parses the JSON string returned by metrics_collect', async () => {
      invokeMock.mockResolvedValue(JSON.stringify({ cpuPercent: 12 }))

      const m = await tauriAdapter.metrics.collect('s1')

      expect(invokeMock).toHaveBeenCalledWith('metrics_collect', { serverId: 's1' })
      expect(m).toEqual({ cpuPercent: 12 })
    })

    it('refreshCache uses its own command', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.metrics.refreshCache('s1')

      expect(invokeMock).toHaveBeenCalledWith('metrics_refresh_cache', { serverId: 's1' })
    })
  })

  describe('services', () => {
    it('start maps the "name" argument to serviceName', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.services.start('s1', 'nginx')

      expect(invokeMock).toHaveBeenCalledWith('services_start', {
        serverId: 's1',
        serviceName: 'nginx',
      })
    })

    it('logs defaults every optional filter to null', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.services.logs('s1', 'nginx')

      expect(invokeMock).toHaveBeenCalledWith('services_logs', {
        serverId: 's1',
        serviceName: 'nginx',
        lines: null,
        since: null,
        priority: null,
      })
    })

    it('followStart defaults lines to null and returns the session id', async () => {
      invokeMock.mockResolvedValue({ success: true, id: 'sess-1' })

      const id = await tauriAdapter.services.followStart('s1', 'nginx', undefined)

      expect(invokeMock).toHaveBeenCalledWith('services_logs_follow_start', {
        serverId: 's1',
        serviceName: 'nginx',
        lines: null,
      })
      expect(id).toBe('sess-1')
    })

    it('followStart throws when the backend reports failure', async () => {
      invokeMock.mockResolvedValue({ success: false, error: 'follow failed' })

      await expect(tauriAdapter.services.followStart('s1', 'nginx')).rejects.toThrow('follow failed')
    })

    it('daemonReload only sends serverId', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.services.daemonReload('s1')

      expect(invokeMock).toHaveBeenCalledWith('services_daemon_reload', { serverId: 's1' })
    })
  })

  describe('processes', () => {
    it('signal forwards pid/signal/startTimeTicks', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.processes.signal('s1', 4321, 'term', 987)

      expect(invokeMock).toHaveBeenCalledWith('processes_signal', {
        serverId: 's1',
        pid: 4321,
        signal: 'term',
        startTimeTicks: 987,
      })
    })
  })

  describe('ports', () => {
    it('killByPid sends serverId and pid', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.ports.killByPid('s1', 8080)

      expect(invokeMock).toHaveBeenCalledWith('ports_kill_by_pid', {
        serverId: 's1',
        pid: 8080,
      })
    })
  })

  describe('network command prefixes', () => {
    it('diagnostics use the network_ prefix', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.network.dns('s1', 'example.com')
      expect(invokeMock).toHaveBeenCalledWith('network_dns', {
        serverId: 's1',
        target: 'example.com',
      })

      await tauriAdapter.network.tcpCheck('s1', '10.0.0.1', 80)
      expect(invokeMock).toHaveBeenCalledWith('network_tcp_check', {
        serverId: 's1',
        host: '10.0.0.1',
        port: 80,
      })
    })

    // 同一个分组里存在两种前缀：diagnostics 用 network_，监控类用 net_
    it('monitoring endpoints use the shorter net_ prefix', async () => {
      invokeMock.mockResolvedValue({})

      await tauriAdapter.network.getOverview('s1')
      expect(invokeMock).toHaveBeenCalledWith('net_overview', { serverId: 's1' })

      await tauriAdapter.network.getInterfaces('s1')
      expect(invokeMock).toHaveBeenCalledWith('net_interfaces', { serverId: 's1' })
    })

    it('getConnections maps an omitted query to null', async () => {
      invokeMock.mockResolvedValue({})

      await tauriAdapter.network.getConnections('s1')

      expect(invokeMock).toHaveBeenCalledWith('net_connections', {
        serverId: 's1',
        query: null,
      })
    })

    it('getCapabilities defaults refresh to false', async () => {
      invokeMock.mockResolvedValue({})

      await tauriAdapter.network.getCapabilities('s1')

      expect(invokeMock).toHaveBeenCalledWith('net_capabilities', {
        serverId: 's1',
        refresh: false,
      })
    })

    it('runQuickCheck defaults port and protocol to null', async () => {
      invokeMock.mockResolvedValue({})

      await tauriAdapter.network.runQuickCheck('s1', 'example.com')

      expect(invokeMock).toHaveBeenCalledWith('net_run_quick_check', {
        serverId: 's1',
        target: 'example.com',
        port: null,
        protocol: null,
      })
    })
  })

  describe('logs', () => {
    it('read maps the path argument to logPath', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.logs.read('s1', '/var/log/app.log', 200)

      expect(invokeMock).toHaveBeenCalledWith('logs_read', {
        serverId: 's1',
        logPath: '/var/log/app.log',
        lines: 200,
      })
    })

    it('search maps the path argument to logPath', async () => {
      invokeMock.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })

      await tauriAdapter.logs.search('s1', '/var/log/app.log', 'ERROR')

      expect(invokeMock).toHaveBeenCalledWith('logs_search', {
        serverId: 's1',
        logPath: '/var/log/app.log',
        keyword: 'ERROR',
      })
    })

    // 接口签名要求 (serverId, path)，但实现按 serverId 索引会话、忽略 path。
    // 这里固化实际 payload：只有 serverId。
    it('stopTail drops the unused path argument', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.logs.stopTail('s1', '/var/log/app.log')

      expect(invokeMock).toHaveBeenCalledWith('logs_stop_tail', { serverId: 's1' })
    })
  })

  describe('snapshot', () => {
    it('generate sends only serverId', async () => {
      invokeMock.mockResolvedValue({})

      await tauriAdapter.snapshot.generate('s1')

      expect(invokeMock).toHaveBeenCalledWith('snapshot_generate', { serverId: 's1' })
    })
  })

  describe('favCmds', () => {
    it('add and update carry cmd/desc', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.favCmds.add('ls -la', 'list all')
      expect(invokeMock).toHaveBeenCalledWith('fav_cmds_add', { cmd: 'ls -la', desc: 'list all' })

      await tauriAdapter.favCmds.update('f1', 'ls', 'shorter')
      expect(invokeMock).toHaveBeenCalledWith('fav_cmds_update', {
        id: 'f1',
        cmd: 'ls',
        desc: 'shorter',
      })
    })

    it('delete and restore use distinct payload keys', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.favCmds.delete('f1')
      expect(invokeMock).toHaveBeenCalledWith('fav_cmds_delete', { id: 'f1' })

      const cmds = [{ id: 'f1' }]
      await tauriAdapter.favCmds.restore!(cmds as never)
      expect(invokeMock).toHaveBeenCalledWith('fav_cmds_restore', { cmds })
    })
  })

  describe('bookmarks', () => {
    // 注意命令名是 bookmarks_list_all，而不是 bookmarks_list
    it('listAll uses bookmarks_list_all', async () => {
      invokeMock.mockResolvedValue(JSON.stringify([{ id: 'b1' }]))

      const rows = await tauriAdapter.bookmarks!.listAll()

      expect(invokeMock).toHaveBeenCalledWith('bookmarks_list_all', undefined)
      expect(rows).toHaveLength(1)
    })

    it('restore wraps items', async () => {
      invokeMock.mockResolvedValue({ success: true })
      const items = [{ id: 'b1' }]

      await tauriAdapter.bookmarks!.restore(items as never)

      expect(invokeMock).toHaveBeenCalledWith('bookmarks_restore', { items })
    })
  })

  describe('backgrounds', () => {
    it('listForSync and restore use their own commands', async () => {
      invokeMock.mockResolvedValue([])
      await tauriAdapter.backgrounds!.listForSync()
      expect(invokeMock).toHaveBeenCalledWith('backgrounds_list_for_sync', undefined)

      invokeMock.mockResolvedValue(2)
      const n = await tauriAdapter.backgrounds!.restore([{ id: 'x' }] as never)
      expect(invokeMock).toHaveBeenCalledWith('backgrounds_restore', { items: [{ id: 'x' }] })
      expect(n).toBe(2)
    })
  })

  describe('window', () => {
    it('create sends label/title/stateJson/x/y', async () => {
      invokeMock.mockResolvedValue(undefined)

      await tauriAdapter.window!.create('win-2', 'Title', '{}', 100, 200)

      expect(invokeMock).toHaveBeenCalledWith('window_create', {
        label: 'win-2',
        title: 'Title',
        stateJson: '{}',
        x: 100,
        y: 200,
      })
    })

    // 注意：命令名是 get_cursor_state，没有 window_ 前缀
    it('getCursorState uses the bare get_cursor_state command', async () => {
      invokeMock.mockResolvedValue({ x: 1, y: 2, leftButtonDown: false })

      await tauriAdapter.window!.getCursorState()

      expect(invokeMock).toHaveBeenCalledWith('get_cursor_state', undefined)
    })

    it('setPosition and startDragging send expected payloads', async () => {
      invokeMock.mockResolvedValue(undefined)

      await tauriAdapter.window!.setPosition('win-2', 10, 20)
      expect(invokeMock).toHaveBeenCalledWith('window_set_position', {
        label: 'win-2',
        x: 10,
        y: 20,
      })

      await tauriAdapter.window!.startDragging()
      expect(invokeMock).toHaveBeenCalledWith('window_start_dragging', undefined)
    })
  })

  describe('auditLogs', () => {
    it('list defaults limit/offset', async () => {
      invokeMock.mockResolvedValue([])

      await tauriAdapter.auditLogs.list('ssh', 'nginx')

      expect(invokeMock).toHaveBeenCalledWith('audit_logs_list', {
        logType: 'ssh',
        searchQuery: 'nginx',
        limit: 50,
        offset: 0,
      })
    })

    // 注意命令名是 record_audit_log（动词在前），与 audit_logs_* 前缀相反
    it('record uses the record_audit_log command', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.auditLogs.record('ssh', 'Server 1', 'connect', 'success', 'detail')

      expect(invokeMock).toHaveBeenCalledWith('record_audit_log', {
        logType: 'ssh',
        serverName: 'Server 1',
        event: 'connect',
        status: 'success',
        details: 'detail',
      })
    })

    it('clear needs no arguments', async () => {
      invokeMock.mockResolvedValue({ success: true })

      await tauriAdapter.auditLogs.clear()

      expect(invokeMock).toHaveBeenCalledWith('audit_logs_clear', undefined)
    })
  })
})
