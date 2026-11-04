import { describe, it, expect, vi } from 'vitest'
import {
  AGENT_TOOLS,
  executeAgentTool,
  normalizeToolName,
  stripDsmlTags,
  stripAllToolCallMarkup,
  extractTextToolCalls,
  type AgentToolExecutionContext,
} from '../agent-tools'
import type { Server, ServerGroup } from '@/types'

vi.mock('@/services/api', () => ({
  backend: {
    ssh: {
      execute: vi.fn().mockImplementation((_connId: string, cmd: string) => {
        return Promise.resolve({
          exitCode: 0,
          stdout: cmd.includes('head')
            ? 'fallback content from head'
            : 'active (running)',
          stderr: '',
        })
      }),
      batchExecute: vi.fn().mockResolvedValue({
        items: [
          {
            serverId: 'srv-1',
            host: '192.168.1.101',
            success: true,
            exitCode: 0,
            stdout: 'Filesystem 50G 20G 30G 40% /',
            stderr: '',
            executionTimeMs: 10,
          },
        ],
      }),
    },
    files: {
      setExclusionConfig: vi.fn(),
      read: vi.fn().mockImplementation((_serverId: string, path: string) => {
        if (path.includes('fail-sftp')) {
          return Promise.reject(new Error('SFTP subsystem disabled'))
        }
        if (path.includes('with-secret')) {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'server {\n  ssl_certificate_key /etc/ssl/private/cert.key;\n  password="SuperSecretPassword123";\n}',
            stderr: '',
          })
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: 'server {\n  listen 80;\n  server_name localhost;\n}',
          stderr: '',
        })
      }),
    },
    metrics: {
      collect: vi.fn(),
    },
  },
}))

describe('AGENT_TOOLS schema', () => {
  it('defines standard OpenAI-compatible tool specifications', () => {
    expect(AGENT_TOOLS).toHaveLength(3)

    const probeTool = AGENT_TOOLS.find((t) => t.function.name === 'probe_server')
    expect(probeTool).toBeDefined()
    expect(probeTool?.type).toBe('function')
    expect(probeTool?.function.parameters.required).toContain('metric')

    const execTool = AGENT_TOOLS.find((t) => t.function.name === 'execute_readonly_command')
    expect(execTool).toBeDefined()
    expect(execTool?.type).toBe('function')
    expect(execTool?.function.parameters.required).toContain('command')

    const sftpTool = AGENT_TOOLS.find((t) => t.function.name === 'sftp_read_file')
    expect(sftpTool).toBeDefined()
    expect(sftpTool?.type).toBe('function')
    expect(sftpTool?.function.parameters.required).toContain('remotePath')
  })
})

describe('executeAgentTool', () => {
  const mockServers: Server[] = [
    {
      id: 'srv-1',
      name: '测试环境-01',
      host: '192.168.1.101',
      port: 22,
      username: 'root',
      authType: 'password',
      targetType: 'linux',
      status: 'online',
      tags: [],
      favorite: false,
      groupId: 'grp-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: 'srv-2',
      name: '生产环境-Web',
      host: '10.0.0.50',
      port: 22,
      username: 'admin',
      authType: 'password',
      targetType: 'linux',
      status: 'online',
      tags: [],
      favorite: false,
      groupId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ]

  const mockGroups: ServerGroup[] = [
    { id: 'grp-1', name: '测试集群', parentId: null, createdAt: Date.now(), updatedAt: Date.now() },
  ]

  const baseContext: AgentToolExecutionContext = {
    servers: mockServers,
    serverGroups: mockGroups,
    activeServerId: 'srv-1',
  }

  it('fails gracefully when no servers are available', async () => {
    const res = await executeAgentTool('probe_server', { metric: 'memory' }, {
      servers: [],
      serverGroups: [],
      activeServerId: null,
    })
    expect(res.success).toBe(false)
    expect(res.output).toContain('当前未连接任何活动服务器终端')
  })

  it('politely intercepts and lists managed servers when on dashboard with no active terminal tab', async () => {
    const res = await executeAgentTool('probe_server', { metric: 'all' }, {
      servers: mockServers,
      serverGroups: mockGroups,
      activeServerId: null,
    })
    expect(res.success).toBe(false)
    expect(res.output).toContain('未找到对应的服务器或未连接终端')
    expect(res.output).toContain('测试环境-01')
    expect(res.output).toContain('生产环境-Web')
    expect(res.output).toContain('操作建议')
  })

  it('politely intercepts when explicitly requested target server is not found in assets', async () => {
    const res = await executeAgentTool('probe_server', { metric: 'all', targetServer: 'non-existent-host' }, {
      servers: mockServers,
      serverGroups: mockGroups,
      activeServerId: 'srv-1',
    })
    expect(res.success).toBe(false)
    expect(res.output).toContain('未找到匹配名称或 IP 为「non-existent-host」的服务器资产')
  })

  it('resolves target server by name or IP accurately', async () => {
    const res = await executeAgentTool(
      'probe_server',
      { metric: 'memory', targetServer: '生产' },
      baseContext,
    )
    expect(res.commandRan).toBeDefined()
    expect(res.explanation).toContain('memory')
  })

  it('executes safe read-only commands under CommandGuard', async () => {
    const res = await executeAgentTool(
      'execute_readonly_command',
      { command: 'systemctl status nginx', explanation: '检查 Nginx 服务运行状态' },
      baseContext,
    )
    expect(res.success).toBe(true)
    expect(res.commandRan).toContain('systemctl status nginx')
    expect(res.explanation).toBe('检查 Nginx 服务运行状态')
  })

  it('strictly blocks write / destructive commands with security warning', async () => {
    const destructiveCommands = [
      'rm -rf /var/log/*',
      'reboot',
      'shutdown -h now',
      'kill -9 1234',
      'dd if=/dev/zero of=/dev/sda',
      'echo "hack" > /etc/passwd',
    ]

    for (const cmd of destructiveCommands) {
      const res = await executeAgentTool(
        'execute_readonly_command',
        { command: cmd, explanation: '尝试破坏' },
        baseContext,
      )
      expect(res.success).toBe(false)
      expect(res.output).toContain('[安全网关拦截]')
      expect(res.commandRan).toBeUndefined()
    }
  })

  it('rejects unknown tool names', async () => {
    const res = await executeAgentTool(
      'unknown_tool_name',
      {},
      baseContext,
    )
    expect(res.success).toBe(false)
    expect(res.output).toContain('未知工具名称')
  })

  it('normalizes duplicated tool names like probe_serverprobe_server and executes successfully', async () => {
    const res = await executeAgentTool(
      'probe_serverprobe_server',
      { metric: 'memory' },
      baseContext,
    )
    expect(res.commandRan).toBeDefined()
    expect(res.explanation).toContain('memory')
  })

  it('automatically heals and routes probe_server to execute_readonly_command when command argument is provided', async () => {
    const res = await executeAgentTool(
      'probe_server',
      { command: 'df -h /tmp', metric: 'disk' },
      baseContext,
    )
    expect(res.commandRan).toContain('df -h /tmp')
    expect(res.explanation).toBeDefined()
  })

  describe('sftp_read_file tool execution', () => {
    it('successfully reads allowed config file via SFTP', async () => {
      const res = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/etc/nginx/nginx.conf' },
        baseContext,
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('listen 80')
      expect(res.explanation).toContain('/etc/nginx/nginx.conf')
    })

    it('blocks sensitive files like SSH keys and shadow', async () => {
      const res1 = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/root/.ssh/id_rsa' },
        baseContext,
      )
      expect(res1.success).toBe(false)
      expect(res1.output).toContain('[安全网关拦截]')

      const res2 = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/etc/shadow' },
        baseContext,
      )
      expect(res2.success).toBe(false)
      expect(res2.output).toContain('[安全网关拦截]')
    })

    it('blocks paths outside the allowed whitelist', async () => {
      const res = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/boot/grub/grub.cfg' },
        baseContext,
      )
      expect(res.success).toBe(false)
      expect(res.output).toContain('[安全网关拦截]')
    })

    it('sanitizes outbound DLP secrets in file content', async () => {
      const res = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/etc/nginx/conf.d/with-secret.conf' },
        baseContext,
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('[REDACTED_SECRET]')
      expect(res.output).not.toContain('SuperSecretPassword123')
    })

    it('falls back to safe head/cat if SFTP fails', async () => {
      const res = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/etc/nginx/fail-sftp.conf' },
        baseContext,
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('fallback content from head')
      expect(res.explanation).toContain('降级')
    })
  })
})

describe('normalizeToolName & stripDsmlTags / stripAllToolCallMarkup & extractTextToolCalls', () => {
  it('correctly normalizes duplicated or messy tool names', () => {
    expect(normalizeToolName('probe_server')).toBe('probe_server')
    expect(normalizeToolName('probe_serverprobe_server')).toBe('probe_server')
    expect(normalizeToolName('execute_readonly_commandexecute_readonly_command')).toBe('execute_readonly_command')
    expect(normalizeToolName('sftp_read_filesftp_read_file')).toBe('sftp_read_file')
    expect(normalizeToolName('custom_tool')).toBe('custom_tool')
  })

  it('strips internal DeepSeek DSML tags', () => {
    const raw = `经排查，结果如下：
<｜DSML｜calls>
<｜DSML｜invoke name="probe_server">
<｜DSML｜parameter name="metric" string="true">memory</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜calls>
内存占用最高的是 EMQX。`

    const stripped = stripDsmlTags(raw)
    expect(stripped).not.toContain('DSML')
    expect(stripped).toContain('内存占用最高的是 EMQX。')
  })

  it('extracts text-based function calls from Qwen XML format', () => {
    const qwenText = `<function=probe_server>
<parameter=metric>
disk

<parameter=targetServer>
81.68.225.246

<parameter=command>
df -h /tmp && du -sh /tmp/* --max-depth=1 2>/dev/null | sort -hr | head -n 10
</function>`

    const extracted = extractTextToolCalls(qwenText)
    expect(extracted).toHaveLength(1)
    expect(extracted[0].name).toBe('probe_server')
    const args = JSON.parse(extracted[0].arguments)
    expect(args.metric).toBe('disk')
    expect(args.targetServer).toBe('81.68.225.246')
    expect(args.command).toContain('df -h /tmp')
  })

  it('extracts tool calls from <tool_call> JSON format', () => {
    const toolCallText = `<tool_call>
{"name": "execute_readonly_command", "arguments": {"command": "ss -tulpn"}}
</tool_call>`

    const extracted = extractTextToolCalls(toolCallText)
    expect(extracted).toHaveLength(1)
    expect(extracted[0].name).toBe('execute_readonly_command')
    const args = JSON.parse(extracted[0].arguments)
    expect(args.command).toBe('ss -tulpn')
  })

  it('thoroughly strips all function, parameter, and tool_call tags from user view', () => {
    const dirtyText = `<think>
排查思路：用户询问 /tmp 分区
</think>

<function=probe_server>
<parameter=metric>
disk
<parameter=command>
df -h /tmp
</function>

经排查，/tmp 分区主要占用为日志文件。`

    const clean = stripAllToolCallMarkup(dirtyText)
    expect(clean).not.toContain('<function')
    expect(clean).not.toContain('<parameter')
    expect(clean).toContain('排查思路：用户询问 /tmp 分区')
    expect(clean).toContain('经排查，/tmp 分区主要占用为日志文件。')
  })
})
