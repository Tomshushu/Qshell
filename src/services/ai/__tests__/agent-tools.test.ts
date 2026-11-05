import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AGENT_TOOLS,
  executeAgentTool,
  normalizeToolName,
  stripDsmlTags,
  stripAllToolCallMarkup,
  extractTextToolCalls,
  loadActiveMcpTools,
  isMcpToolName,
  type AgentToolExecutionContext,
} from '../agent-tools'
import type { Server, ServerGroup } from '@/types'
import { backend } from '@/services/api'
import { useAppStore } from '@/store'

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
    mcpClient: {
      listActiveTools: vi.fn().mockResolvedValue([
        {
          // 真实内置插件：必须带 ssh_native 传输标记才允许走 SSH 直连诊断
          pluginId: 'builtin-java',
          pluginName: 'Java / JVM 应用诊断',
          pluginIcon: 'java',
          qualifiedName: 'mcp__builtin_java__list_java_processes',
          toolName: 'list_java_processes',
          description: '[Java / JVM 应用诊断 插件] 扫描 Java 进程',
          inputSchema: { type: 'object', properties: {} },
          isReadOnly: true,
          transport: 'ssh_native',
        },
        {
          // 真实外部插件：走 Rust MCP Client，不应被内置 SSH 分支劫持
          pluginId: 'ext-k8s',
          pluginName: '外部 K8s 插件',
          pluginIcon: 'kubernetes',
          qualifiedName: 'mcp__ext_k8s__get_pods',
          toolName: 'get_pods',
          description: '[外部 K8s 插件] 查询指定命名空间的 Pod 状态',
          inputSchema: {
            type: 'object',
            properties: {
              namespace: { type: 'string' },
            },
          },
          isReadOnly: true,
          transport: 'stdio',
        },
      ]),
      callTool: vi.fn().mockImplementation(
        (_pluginId: string, toolName: string, args: Record<string, unknown>) => {
          if (toolName === 'get_pods') {
            return Promise.resolve({
              pluginId: 'builtin-kubernetes',
              pluginName: 'Kubernetes (K8s)',
              toolName: 'get_pods',
              isError: false,
              text: `NAMESPACE=${args.namespace || 'default'} POD=payment-7d8f9 STATUS=CrashLoopBackOff password="SecretDbPassword999"`,
              durationMs: 25,
            })
          }
          return Promise.resolve({
            pluginId: _pluginId,
            pluginName: 'Unknown',
            toolName,
            isError: true,
            text: 'Tool failed',
            durationMs: 10,
          })
        },
      ),
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
    expect(res.output).toContain('尚无可用服务器资产')
    expect(res.output).toContain('无需手动打开终端')
  })

  it('politely intercepts and lists managed servers when several hosts exist without an active terminal', async () => {
    const res = await executeAgentTool('probe_server', { metric: 'all' }, {
      servers: mockServers,
      serverGroups: mockGroups,
      activeServerId: null,
    })
    expect(res.success).toBe(false)
    expect(res.output).toContain('请指定目标服务器')
    expect(res.output).toContain('测试环境-01')
    expect(res.output).toContain('生产环境-Web')
    expect(res.output).toContain('操作建议')
    expect(res.output).toContain('无需打开终端')
  })

  it('politely intercepts when explicitly requested target server is not found in assets', async () => {
    const res = await executeAgentTool('probe_server', { metric: 'all', targetServer: 'non-existent-host' }, {
      servers: mockServers,
      serverGroups: mockGroups,
      activeServerId: 'srv-1',
    })
    expect(res.success).toBe(false)
    expect(res.output).toContain('未找到匹配的服务器')
    expect(res.output).toContain('non-existent-host')
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

  it('no longer hard-blocks a deeper find and returns its execution output', async () => {
    const res = await executeAgentTool(
      'execute_readonly_command',
      { command: 'find / -maxdepth 5 -name "poetry**" -type f 2>/dev/null | head -n 20' },
      baseContext,
    )
    expect(res.success).toBe(true)
    expect(res.commandRan).toContain('-maxdepth 5')
    expect(res.output).not.toContain('[安全网关拦截]')
  })

  it('honors executionMode in the Agent tool chain instead of always auto-running', async () => {
    const disabledRes = await executeAgentTool(
      'execute_readonly_command',
      { command: 'df -h' },
      { ...baseContext, executionMode: 'disabled' },
    )
    expect(disabledRes.success).toBe(false)
    expect(disabledRes.output).toContain('只读问答')
    expect(disabledRes.commandRan).toBeUndefined()

    const askRes = await executeAgentTool(
      'execute_readonly_command',
      { command: 'df -h' },
      { ...baseContext, executionMode: 'ask' },
    )
    expect(askRes.success).toBe(false)
    expect(askRes.output).toContain('询问确认')
    expect(askRes.commandRan).toBeUndefined()

    const autoRes = await executeAgentTool(
      'execute_readonly_command',
      { command: 'df -h' },
      { ...baseContext, executionMode: 'auto_readonly' },
    )
    expect(autoRes.success).toBe(true)
    expect(autoRes.commandRan).toContain('df -h')
  })

  it('runs write commands in danger mode with a preview, but still blocks red lines', async () => {
    const writeRes = await executeAgentTool(
      'execute_readonly_command',
      { command: 'systemctl restart nginx' },
      { ...baseContext, executionMode: 'danger' },
    )
    expect(writeRes.success).toBe(true)
    expect(writeRes.output).toContain('危险模式执行预览')

    const redLineRes = await executeAgentTool(
      'execute_readonly_command',
      { command: 'rm -rf /tmp/data' },
      { ...baseContext, executionMode: 'danger' },
    )
    expect(redLineRes.success).toBe(false)
    expect(redLineRes.output).toContain('安全网关拦截')
  })

  describe('auto-connect with saved credentials (no terminal session required)', () => {
    const batchExecuteMock = backend!.ssh.batchExecute as unknown as ReturnType<typeof vi.fn>
    const executeMock = backend!.ssh.execute as unknown as ReturnType<typeof vi.fn>
    const noTerminalContext: AgentToolExecutionContext = {
      servers: [mockServers[0]],
      serverGroups: mockGroups,
      activeServerId: null,
    }

    beforeEach(() => {
      useAppStore.setState({ tabs: [], connectedServers: {}, activeTabId: null })
      batchExecuteMock.mockClear()
    })

    it('runs a read-only command on the only managed server without an open terminal', async () => {
      const res = await executeAgentTool(
        'execute_readonly_command',
        { command: 'systemctl status nginx' },
        noTerminalContext,
      )
      expect(batchExecuteMock).toHaveBeenCalledWith(
        ['srv-1'],
        expect.stringContaining('systemctl status nginx'),
        10,
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('Filesystem 50G')
    })

    it('reconnects with saved credentials when an existing SSH session fails', async () => {
      executeMock.mockRejectedValueOnce(new Error('session closed'))
      const res = await executeAgentTool(
        'execute_readonly_command',
        { command: 'df -h' },
        baseContext,
      )
      expect(batchExecuteMock).toHaveBeenCalledTimes(1)
      expect(res.success).toBe(true)
      expect(res.output).toContain('Filesystem 50G')
    })

    it('does not re-run via batchExecute when an active session command exits non-zero with empty output', async () => {
      useAppStore.setState({
        tabs: [{ id: 'tab-1', serverId: 'srv-1' } as never],
        connectedServers: { 'srv-1': 'srv-1' } as never,
        activeTabId: 'tab-1',
      })
      executeMock.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: '',
      })
      const res = await executeAgentTool(
        'execute_readonly_command',
        { command: 'grep -i "ERROR_NOT_FOUND" /var/log/syslog' },
        baseContext,
      )
      expect(batchExecuteMock).not.toHaveBeenCalled()
      expect(res.success).toBe(false)
    })

    it('runs ssh_native MCP plugin diagnostics without an open terminal', async () => {
      const res = await executeAgentTool(
        'mcp__builtin_java__list_java_processes',
        {},
        noTerminalContext,
      )
      expect(batchExecuteMock).toHaveBeenCalledWith(['srv-1'], expect.any(String), 12)
      expect(res.success).toBe(true)
      expect(res.explanation).toContain('测试环境-01')
    })

    it('falls back to head over an auto-connected SSH session when SFTP is unavailable', async () => {
      const res = await executeAgentTool(
        'sftp_read_file',
        { remotePath: '/etc/nginx/fail-sftp.conf' },
        noTerminalContext,
      )
      expect(batchExecuteMock).toHaveBeenCalledWith(
        ['srv-1'],
        expect.stringContaining('head -n'),
        10,
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('Filesystem 50G')
    })
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

  describe('External MCP Client & Zero-Config SSH-Native plugin tools execution', () => {
    const activeToolsMock = (backend as any).mcpClient.listActiveTools
    const callToolMock = (backend as any).mcpClient.callTool

    it('loads active MCP tools and formats them for OpenAI Function Calling', async () => {
      const bundle = await loadActiveMcpTools()
      expect(bundle.openAiTools).toHaveLength(2)
      expect(bundle.activeToolsMap.has('mcp__ext_k8s__get_pods')).toBe(true)
      expect(isMcpToolName('mcp__ext_k8s__get_pods')).toBe(true)
      expect(isMcpToolName('probe_server')).toBe(false)
    })

    it('executes zero-config SSH-native plugin tool (e.g. Java / Docker diagnosis) directly over existing SSH server credentials', async () => {
      const res = await executeAgentTool(
        'mcp__builtin_java__list_java_processes',
        {},
        baseContext,
      )
      expect(res.success).toBe(true)
      expect(res.commandRan).toContain('[Java / JVM 应用诊断] list_java_processes')
      expect(res.explanation).toContain('测试环境-01')
    })

    it('executes external MCP tool without requiring an active SSH server and enforces S1 outbound DLP sanitization', async () => {
      const bundle = await loadActiveMcpTools()
      const res = await executeAgentTool(
        'mcp__ext_k8s__get_pods',
        { namespace: 'production' },
        {
          servers: [],
          serverGroups: [],
          activeServerId: null,
          activeMcpToolsMap: bundle.activeToolsMap,
        },
      )
      expect(res.success).toBe(true)
      expect(res.output).toContain('NAMESPACE=production')
      expect(res.output).toContain('CrashLoopBackOff')
      expect(res.output).toContain('[REDACTED_SECRET]')
      expect(res.output).not.toContain('SecretDbPassword999')
      expect(res.commandRan).toContain('[MCP:外部 K8s 插件] get_pods')
      // 审计标签不得包含参数值，只能包含参数名
      expect(res.commandRan).toContain('namespace')
      expect(res.commandRan).not.toContain('production')
    })

    it('rejects unregistered or disabled MCP tool names before any SSH execution', async () => {
      activeToolsMock.mockResolvedValueOnce([])
      const res = await executeAgentTool(
        'mcp__builtin_docker__inspect_abnormal_containers',
        {},
        baseContext,
      )
      expect(res.success).toBe(false)
      expect(res.output).toContain('安全策略拒绝')
      expect(res.commandRan).toBeUndefined()
    })

    it('does not hijack an external tool sharing a builtin diagnostic tool name', async () => {
      activeToolsMock.mockResolvedValueOnce([
        {
          pluginId: 'ext-docker',
          pluginName: '外部 Docker 插件',
          pluginIcon: 'docker',
          qualifiedName: 'mcp__ext_docker__inspect_abnormal_containers',
          toolName: 'inspect_abnormal_containers',
          description: 'external docker inspection',
          inputSchema: { type: 'object', properties: {} },
          isReadOnly: true,
          transport: 'stdio',
        },
      ])
      const res = await executeAgentTool(
        'mcp__ext_docker__inspect_abnormal_containers',
        {},
        baseContext,
      )
      expect(callToolMock).toHaveBeenCalledWith('ext-docker', 'inspect_abnormal_containers', {})
      expect(res.commandRan).toContain('[MCP:外部 Docker 插件]')
      expect(res.commandRan).not.toContain('[Docker 容器深度排障]')
    })

    it('blocks write-capable MCP tools unless the user explicitly authorizes them', async () => {
      const writeTool = {
        pluginId: 'ext-writer',
        pluginName: '外部写插件',
        pluginIcon: 'custom',
        qualifiedName: 'mcp__ext_writer__delete_pod',
        toolName: 'delete_pod',
        description: 'delete a pod',
        inputSchema: { type: 'object', properties: {} },
        isReadOnly: false,
        transport: 'stdio',
      }

      activeToolsMock.mockResolvedValueOnce([writeTool])
      const blocked = await executeAgentTool('mcp__ext_writer__delete_pod', {}, baseContext)
      expect(blocked.success).toBe(false)
      expect(blocked.output).toContain('安全策略拒绝')
      expect(callToolMock).not.toHaveBeenCalledWith('ext-writer', 'delete_pod', {})

      activeToolsMock.mockResolvedValueOnce([writeTool])
      const allowed = await executeAgentTool(
        'mcp__ext_writer__delete_pod',
        {},
        { ...baseContext, allowWriteMcpTools: true },
      )
      expect(callToolMock).toHaveBeenCalledWith('ext-writer', 'delete_pod', {})
      expect(allowed.output).not.toContain('安全策略拒绝')
    })
  })
})

describe('normalizeToolName & stripDsmlTags / stripAllToolCallMarkup & extractTextToolCalls', () => {
  it('correctly normalizes duplicated or messy tool names including mcp__ tools', () => {
    expect(normalizeToolName('probe_server')).toBe('probe_server')
    expect(normalizeToolName('probe_serverprobe_server')).toBe('probe_server')
    expect(normalizeToolName('execute_readonly_commandexecute_readonly_command')).toBe('execute_readonly_command')
    expect(normalizeToolName('sftp_read_filesftp_read_file')).toBe('sftp_read_file')
    expect(normalizeToolName('mcp__builtin_kubernetes__get_pods')).toBe('mcp__builtin_kubernetes__get_pods')
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
