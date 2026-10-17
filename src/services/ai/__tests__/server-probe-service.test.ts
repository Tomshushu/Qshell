import { describe, it, expect, vi } from 'vitest'
import {
  SAFE_PROBE_COMMANDS,
  resolveProbePlan,
  buildServerInventory,
  formatProbeReportForAI,
  executeSafeProbe,
  findActiveConnectionId,
  formatSystemMetricsSummary,
} from '../server-probe-service'
import type { Server, ServerGroup } from '@/types'

vi.mock('@/services/api', () => ({
  backend: {
    ssh: {
      batchExecute: vi.fn().mockResolvedValue({
        items: [
          {
            serverId: 'srv_1',
            host: '192.168.1.101',
            success: true,
            exitCode: 0,
            stdout: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   30G  40% /',
            stderr: '',
            executionTimeMs: 15,
          },
        ],
      }),
      execute: vi.fn(),
    },
    metrics: {
      collect: vi.fn(),
    },
  },
}))

const mockGroups: ServerGroup[] = [
  {
    id: 'grp_prod',
    name: '生产环境',
    parentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'grp_test',
    name: '测试环境',
    parentId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

const mockServers: Server[] = [
  {
    id: 'srv_1',
    name: 'Web-Prod-01',
    host: '192.168.1.101',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'super-secret-password-1',
    tags: ['web', 'prod'],
    favorite: true,
    status: 'online',
    groupId: 'grp_prod',
    targetType: 'linux',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'srv_2',
    name: 'DB-Prod-Master',
    host: '192.168.1.102',
    port: 22,
    username: 'root',
    authType: 'password',
    password: 'super-secret-password-2',
    tags: ['db', 'prod'],
    favorite: false,
    status: 'online',
    groupId: 'grp_prod',
    targetType: 'linux',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'srv_3',
    name: 'Test-Node',
    host: '10.0.0.50',
    port: 22,
    username: 'admin',
    authType: 'password',
    tags: ['test'],
    favorite: false,
    status: 'online',
    groupId: 'grp_test',
    targetType: 'linux',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'srv_4',
    name: 'Dell-iDRAC-Bmc',
    host: '192.168.1.200',
    port: 443,
    username: 'root',
    authType: 'password',
    tags: ['bmc'],
    favorite: false,
    status: 'online',
    groupId: 'grp_prod',
    targetType: 'bmc',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

describe('Server Probe Service - Security & Probing Rules', () => {
  describe('Strict Read-Only & Non-traversal Command Audit', () => {
    it('must NEVER contain recursive traversal or destructive commands', () => {
      const allCommands = Object.values(SAFE_PROBE_COMMANDS)
      for (const cmd of allCommands) {
        expect(cmd).not.toContain('find /')
        expect(cmd).not.toContain('du -sh /*')
        expect(cmd).not.toContain('rm ')
        expect(cmd).not.toContain('dd ')
        expect(cmd).not.toContain('truncate')
        expect(cmd).not.toContain('mkfs')
        expect(cmd).not.toContain('chmod')
        expect(cmd).not.toContain('chown')
        expect(cmd).not.toContain('kill')
      }
    })

    it('must use fast kernel superblock and /proc pseudo-filesystem queries', () => {
      expect(SAFE_PROBE_COMMANDS.linuxDisk).toContain('df -h -P')
      expect(SAFE_PROBE_COMMANDS.linuxMemory).toContain('free -m')
      expect(SAFE_PROBE_COMMANDS.linuxCpu).toContain('loadavg')
    })
  })

  describe('Server Inventory Topology Sanitization', () => {
    it('must sanitize credentials (never leak passwords or private keys)', () => {
      const inventory = buildServerInventory(mockServers, mockGroups)
      expect(inventory).toContain('Web-Prod-01')
      expect(inventory).toContain('192.168.1.101')
      expect(inventory).toContain('生产环境')

      // 绝不可泄露密码
      expect(inventory).not.toContain('super-secret-password-1')
      expect(inventory).not.toContain('super-secret-password-2')
    })
  })

  describe('Target & Metric Intent Resolution', () => {
    it('should resolve server group correctly', () => {
      const plan = resolveProbePlan('帮我看看 生产 分组的磁盘占用', mockServers, mockGroups)
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('disk')
      expect(plan.targetServers.map((s) => s.id)).toEqual(['srv_1', 'srv_2'])
      // BMC 类型自动过滤
      expect(plan.targetServers.some((s) => s.targetType === 'bmc')).toBe(false)
    })

    it('should resolve specific server by name', () => {
      const plan = resolveProbePlan('看下 Test-Node 内存怎么样', mockServers, mockGroups)
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('memory')
      expect(plan.targetServers).toHaveLength(1)
      expect(plan.targetServers[0].name).toBe('Test-Node')
    })

    it('should resolve specific server by IP/host', () => {
      const plan = resolveProbePlan('检查一下 192.168.1.101 的 CPU 和负载', mockServers, mockGroups)
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('cpu')
      expect(plan.targetServers).toHaveLength(1)
      expect(plan.targetServers[0].host).toBe('192.168.1.101')
    })

    it('should resolve cluster-wide disk check when asking about multiple/all servers on dashboard', () => {
      const plan = resolveProbePlan(
        '帮我看看当前这几台服务器的状态，哪些磁盘满了',
        mockServers,
        mockGroups,
        null,
      )
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('disk')
      expect(plan.targetServers.length).toBe(3) // 3 台 SSH 服务器，排除了 BMC
    })

    it('should resolve active server when in active session', () => {
      const plan = resolveProbePlan('当前机器的内存情况怎么样', mockServers, mockGroups, 'srv_1')
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('memory')
      expect(plan.targetServers).toHaveLength(1)
      expect(plan.targetServers[0].id).toBe('srv_1')
    })

    it('should not probe when query is purely conversational or general knowledge', () => {
      const generalQueries = [
        '写一个备份数据库的 bash 脚本',
        '什么是 Docker 容器？',
        'Docker 和 Podman 的区别是什么？',
        '如何安装 Nginx？',
        '为什么 80 端口会被 TIME_WAIT 占用？',
        '介绍一下 Linux 内存管理机制',
      ]
      for (const q of generalQueries) {
        const plan = resolveProbePlan(q, mockServers, mockGroups, 'srv_1')
        expect(plan.shouldProbe, `Expected "${q}" NOT to trigger probe`).toBe(false)
        expect(plan.targetServers).toHaveLength(0)
      }
    })

    it('should resolve container probe intent for docker queries', () => {
      const plan = resolveProbePlan('查看一下当前服务器上运行的容器状态', mockServers, mockGroups, 'srv_1')
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('container')
      expect(plan.targetServers).toHaveLength(1)
      expect(plan.targetServers[0].id).toBe('srv_1')
    })

    it('should resolve network probe intent for port listening queries', () => {
      const plan = resolveProbePlan('查看一下服务器80端口监听与网络连接状态', mockServers, mockGroups, 'srv_1')
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('network')
      expect(plan.targetServers).toHaveLength(1)
    })

    it('should resolve process probe intent for high load process queries', () => {
      const plan = resolveProbePlan('查一下当前服务器的高占用进程列表和服务状态', mockServers, mockGroups, 'srv_1')
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('process')
      expect(plan.targetServers).toHaveLength(1)
    })

    it('should resolve memory probe intent with process snapshot for high memory application queries', () => {
      const plan = resolveProbePlan('帮我看看这台服务器上内存占用最高的那个应用是哪个', mockServers, mockGroups, 'srv_1')
      expect(plan.shouldProbe).toBe(true)
      expect(plan.metric).toBe('memory')
      expect(plan.targetServers).toHaveLength(1)
      expect(plan.targetServers[0].id).toBe('srv_1')
    })

    it('should resolve holistic "all" probe intent for broad troubleshooting and bottleneck queries', () => {
      const broadQueries = [
        '服务器有点卡，帮我排查一下',
        '帮我全面体检一下系统状态',
        '这台机器响应很慢，排查一下瓶颈',
      ]
      for (const q of broadQueries) {
        const plan = resolveProbePlan(q, mockServers, mockGroups, 'srv_1')
        expect(plan.shouldProbe, `Expected "${q}" to trigger probe`).toBe(true)
        expect(plan.metric).toBe('all')
        expect(plan.targetServers).toHaveLength(1)
      }
    })
  })

  describe('Active Connection Resolution (findActiveConnectionId)', () => {
    it('should find active ws session tab connection for server', () => {
      const tabs = [{ id: 'tab_99', serverId: 'srv_1' }]
      const connected = { 'ws:srv_1:tab_99': true, srv_2: false }

      const connId = findActiveConnectionId('srv_1', tabs, connected)
      expect(connId).toBe('ws:srv_1:tab_99')
    })

    it('should fall back to serverId direct connection if ws tab not present', () => {
      const tabs = [{ id: 'tab_88', serverId: 'srv_3' }]
      const connected = { srv_1: true }

      const connId = findActiveConnectionId('srv_1', tabs, connected)
      expect(connId).toBe('srv_1')
    })

    it('should return null when server has no active connections', () => {
      const tabs = [{ id: 'tab_88', serverId: 'srv_3' }]
      const connected = { srv_3: false }

      const connId = findActiveConnectionId('srv_1', tabs, connected)
      expect(connId).toBeNull()
    })
  })

  describe('Structured System Metrics Formatting', () => {
    it('should format cpu, memory and disk metrics accurately', () => {
      const summary = formatSystemMetricsSummary(
        {
          cpuUsage: 12.5,
          cpuLoad: [0.15, 0.25, 0.3],
          uptime: 86400 * 3 + 3600 * 5,
          memoryTotal: 4.0,
          memoryUsed: 3.12,
          swapTotal: 2.0,
          swapUsed: 0.1,
          disks: [
            {
              filesystem: '/dev/vda1',
              mountPoint: '/',
              total: 50.0,
              used: 17.3,
              available: 32.7,
              usePercent: 34.7,
              category: 'disk',
            },
          ],
        },
        'all',
      )

      expect(summary).toContain('CPU 总使用率: 12.5%')
      expect(summary).toContain('系统平均负载 (1/5/15分钟): 0.15, 0.25, 0.30')
      expect(summary).toContain('已使用 3.1 GB / 总计 4.0 GB')
      expect(summary).toContain('挂载点 /: 已用 17.3 GB / 总计 50.0 GB (使用率: 34.7%')
    })

    it('should filter only memory metrics when metric is memory', () => {
      const summary = formatSystemMetricsSummary(
        {
          cpuUsage: 12.5,
          memoryTotal: 4.0,
          memoryUsed: 3.12,
        },
        'memory',
      )

      expect(summary).toContain('【内存指标】')
      expect(summary).not.toContain('【CPU 与系统负载】')
      expect(summary).not.toContain('【磁盘存储指标】')
    })
  })

  describe('Probe Execution & AI Report Formatting', () => {
    it('should execute safe probe and produce structured AI report', async () => {
      const res = await executeSafeProbe([mockServers[0]], 'disk')
      expect(res.total).toBe(1)
      expect(res.succeeded).toBe(1)
      expect(res.items[0].output).toContain('Filesystem')

      const formatted = formatProbeReportForAI(res, '生产环境')
      expect(formatted).toContain('【只读指标实时探测结果】')
      expect(formatted).toContain('Web-Prod-01')
      expect(formatted).toContain('磁盘存储指标')
      expect(formatted).toContain('成功获取实时指标')
      // 绝不输出断言离线的文字
      expect(formatted).not.toContain('❌ 失败/离线')
    })
  })
})
