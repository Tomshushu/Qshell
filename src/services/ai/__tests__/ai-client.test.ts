import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildModelsEndpoint,
  fetchProviderModels,
  extractCommandsFromContent,
  isLikelyShellCommand,
  sendAssistantChat,
  testConnection,
} from '../ai-client'
import type { AISettings } from '@/types/ai'

describe('ai-client buildModelsEndpoint', () => {
  it('correctly maps OpenAI and compatible endpoints', () => {
    expect(buildModelsEndpoint('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1/models')
    expect(buildModelsEndpoint('https://api.deepseek.com', 'openai')).toBe('https://api.deepseek.com/models')
    expect(buildModelsEndpoint('https://api.siliconflow.cn/v1', 'openai')).toBe('https://api.siliconflow.cn/v1/models')
    expect(buildModelsEndpoint('https://api.groq.com/openai/v1', 'openai')).toBe('https://api.groq.com/openai/v1/models')
    expect(buildModelsEndpoint('http://127.0.0.1:11434/v1', 'openai')).toBe('http://127.0.0.1:11434/v1/models')
    expect(buildModelsEndpoint('https://my-proxy.com/chat/completions', 'openai')).toBe('https://my-proxy.com/models')
  })

  it('correctly maps Gemini and Anthropic endpoints', () => {
    expect(buildModelsEndpoint('https://generativelanguage.googleapis.com', 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(buildModelsEndpoint('https://api.anthropic.com/v1', 'anthropic')).toBe('https://api.anthropic.com/v1/models')
  })
})

describe('fetchProviderModels', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parses standard OpenAI format with smart chat model prioritization', async () => {
    const mockResponse = {
      object: 'list',
      data: [
        { id: 'text-embedding-3-small' },
        { id: 'gpt-4o' },
        { id: 'gpt-4o-mini' },
        { id: 'whisper-1' },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const settings: AISettings = {
      provider: 'openai',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: true,
      maskPrivateIps: false,
    }

    const models = await fetchProviderModels(settings)
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'whisper-1'])
  })

  it('parses Ollama /api/tags format', async () => {
    const mockResponse = {
      models: [
        { name: 'qwen2.5-coder:7b', modified_at: '2026-10-10' },
        { name: 'deepseek-r1:14b', modified_at: '2026-10-11' },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const settings: AISettings = {
      provider: 'ollama',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder:7b',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: true,
      maskPrivateIps: false,
    }

    const models = await fetchProviderModels(settings)
    expect(models).toContain('qwen2.5-coder:7b')
    expect(models).toContain('deepseek-r1:14b')
  })
})

describe('extractCommandsFromContent & isLikelyShellCommand', () => {
  it('correctly filters out non-shell blocks (like text, json) and extracts real shell commands', () => {
    const rawAiOutput = `
以下是服务器的资源探测结果：

\`\`\`text
【内存指标】
总内存：3.84 GB
已使用：2.37 GB (61.7%)
空闲内存：0.21 GB
Buffer/Cache：1.26 GB
\`\`\`

经分析，内存占用较高，建议使用如下命令进一步排查占用前 10 的应用：

\`\`\`bash
# 查看内存占用最高的 10 个进程
$ ps aux --sort=-%mem | head -n 10
\`\`\`

同时你也可以查看磁盘状态：

\`\`\`json
{
  "disk": "/dev/vda1",
  "usage": "45%"
}
\`\`\`
`

    const commands = extractCommandsFromContent(rawAiOutput)
    // 必须只有 1 条命令，且决不能把 text 代码块误提取为命令
    expect(commands).toHaveLength(1)
    expect(commands[0].command).toBe('ps aux --sort=-%mem | head -n 10')
    expect(commands[0].risk.level).toBe('safe')
  })

  it('validates isLikelyShellCommand properly', () => {
    // 应该被排除的非法命令 / 文本
    expect(isLikelyShellCommand('text')).toBe(false)
    expect(isLikelyShellCommand('test')).toBe(false)
    expect(isLikelyShellCommand('txt')).toBe(false)
    expect(isLikelyShellCommand('output')).toBe(false)
    expect(isLikelyShellCommand('【内存指标】')).toBe(false)
    expect(isLikelyShellCommand('这是中文说明')).toBe(false)
    expect(isLikelyShellCommand('1. 查看系统状态')).toBe(false)
    expect(isLikelyShellCommand('# 这是注释')).toBe(false)

    // 应该通过的合法命令
    expect(isLikelyShellCommand('ps aux --sort=-%mem')).toBe(true)
    expect(isLikelyShellCommand('docker ps -a')).toBe(true)
    expect(isLikelyShellCommand('systemctl status nginx')).toBe(true)
    expect(isLikelyShellCommand('Get-Process')).toBe(true)
    expect(isLikelyShellCommand('./deploy.sh')).toBe(true)
  })
})

describe('sendAssistantChat with Option A Native Tool Calling', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const baseSettings: AISettings = {
    provider: 'openai',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2048,
    enableDlp: false,
    maskPrivateIps: false,
  }

  it('handles standard direct reply when model does not use tools', async () => {
    // Non-streaming mock response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '你好！我是 Qshell AI 助手，请问有什么可以帮助您？',
            },
          },
        ],
      }),
    })

    const res = await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '你好' }],
      'agent',
      {},
    )

    expect(res.content).toContain('我是 Qshell AI 助手')
    expect(res.executedTool).toBeUndefined()
  })

  it('injects Rule 8 for out-of-domain query handling and command protection into system prompt', async () => {
    let capturedBody: any = null
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '回复内容',
              },
            },
          ],
        }),
      }
    })

    // 1. Agent 模式
    await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '小猫有哪些品种' }],
      'agent',
      {},
    )
    const agentSysMsg = capturedBody.messages.find((m: any) => m.role === 'system')?.content || ''
    expect(agentSysMsg).toContain('非运维、生活闲聊与跨领域提问处理规范')
    expect(agentSysMsg).toContain('严格阻断工具执行与 Shell 命令生成')
    expect(agentSysMsg).toContain('多义词与技术歧义保护')

    // 2. Chat 模式
    await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '小猫有哪些品种' }],
      'chat',
      {},
    )
    const chatSysMsg = capturedBody.messages.find((m: any) => m.role === 'system')?.content || ''
    expect(chatSysMsg).toContain('生活常识或日常闲聊')
    expect(chatSysMsg).toContain('自然引导用户咨询服务器运维')
  })

  it('enforces end-of-response placement for server selection prompts and omits tools in Explain Shell', async () => {
    let capturedBody: any = null
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'awk 提取列，sort 排序，uniq -c 统计频次。',
              },
            },
          ],
        }),
      }
    })

    await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: "awk '{print $1}' access.log | sort | uniq -c" }],
      'agent',
      { isExplainShell: true, activeServerId: null },
    )

    const sysMsg = capturedBody.messages.find((m: any) => m.role === 'system')?.content || ''
    expect(sysMsg).toContain('【指令拆解与管道流转分析】')
    expect(sysMsg).toContain('首行首段绝对纯净，严禁前置免责阻断')
    expect(sysMsg).toContain('所有关于“引导在下方卡片中选择目标主机”的提示文案，必须且只能放置在回答的正文最末尾')
    expect(capturedBody.tools).toBeUndefined()
  })

  it('injects Docker diagnosis mission and exit code attribution guidelines into system prompt', async () => {
    let capturedBody: any = null
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, options: any) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '容器因超出 512MB 内存限额被 Linux 内核 SIGKILL (137) 强制杀掉。',
              },
            },
          ],
        }),
      }
    })

    await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '请帮我诊断 Docker 容器' }],
      'agent',
      {
        isDockerDiagnosis: true,
        dockerContext: {
          serverId: 'srv-1',
          containerId: 'c1234567890abcdef',
          containerName: 'payment-service',
          image: 'openjdk:17',
          status: 'Exited (137) 2 minutes ago',
          exitCode: 137,
          oomKilled: true,
          memoryLimit: 536870912,
        },
      },
    )

    const sysMsg = capturedBody.messages.find((m: any) => m.role === 'system')?.content || ''
    expect(sysMsg).toContain('【Docker 容器异常退出即时归因任务】')
    expect(sysMsg).toContain('payment-service')
    expect(sysMsg).toContain('OOMKilled: true')
    expect(sysMsg).toContain('退出码: 137')
    expect(sysMsg).toContain('必须在正文第一行直接给出清晰明确的【退出根因归因结论】')
  })

  it('executes tool calling and synthesizes final diagnostic report when model calls probe_server', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        // Step 1: Model emits tool_calls
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '<think>用户询问内存占用最高，需要调用 probe_server 探针</think>',
                  tool_calls: [
                    {
                      id: 'call_probe_123',
                      type: 'function',
                      function: {
                        name: 'probe_server',
                        arguments: JSON.stringify({ metric: 'memory' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        }
      } else {
        // Step 2: Model receives tool output and returns final diagnostic conclusion
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '经现场实时排查，公租房测试环境上内存占用最高的是 **EMQX 消息服务**（占用 18.2%）。\n\n```bash\nps aux --sort=-%mem | head -n 5\n```',
                },
              },
            ],
          }),
        }
      }
    })

    const mockServers = [
      {
        id: 'srv-1',
        name: '公租房测试环境',
        host: '192.168.1.101',
        port: 22,
        username: 'root',
        authType: 'password',
        targetType: 'linux',
        status: 'online',
      },
    ]

    const onChunkMock = vi.fn()

    const res = await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '内存占用最高的是哪个应用' }],
      'agent',
      {
        servers: mockServers as any,
        activeServerId: 'srv-1',
      },
      undefined,
      onChunkMock,
    )

    expect(callCount).toBe(2)
    expect(res.executedTool).toBeDefined()
    expect(res.executedTool?.explanation).toContain('memory')
    expect(res.content).toContain('Agent 智能决策调用')
    expect(res.content).toContain('EMQX 消息服务')
    expect(res.commands).toHaveLength(1)
    expect(res.commands[0].command).toBe('ps aux --sort=-%mem | head -n 5')
  })

  it('supports multi-step ReAct loop with Qwen XML text tool calls and strips tags from final output', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        // Step 1: Probe disk
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '<think>排查磁盘宏观水位</think>',
                  tool_calls: [
                    {
                      id: 'call_disk_1',
                      type: 'function',
                      function: {
                        name: 'probe_server',
                        arguments: JSON.stringify({ metric: 'disk' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        }
      } else if (callCount === 2) {
        // Step 2: Model emits Qwen-style XML function call for deeper inspection of /tmp
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: `<think>根分区 37%，但用户提示 /tmp 满了，深入检查 /tmp 目录</think>
<function=probe_server>
<parameter=metric>
disk
<parameter=command>
du -sh /tmp/* --max-depth=1 | sort -hr | head -n 5
</function>`,
                },
              },
            ],
          }),
        }
      } else {
        // Step 3: Final diagnostic synthesis
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: `经现场多层级深入排查，/tmp 分区主要占用文件为 **qshell_test_bloat.log**（占用 300MB）。

建议执行清理命令：
\`\`\`bash
rm -f /tmp/qshell_test_bloat.log
\`\`\``,
                },
              },
            ],
          }),
        }
      }
    })

    const mockServers = [
      {
        id: 'srv-1',
        name: '测试环境',
        host: '10.0.0.1',
        port: 22,
        username: 'root',
        authType: 'password',
        targetType: 'linux',
        status: 'online',
      },
    ]

    const res = await sendAssistantChat(
      baseSettings,
      [{ role: 'user', content: '系统提示 /tmp 分区快满了，帮我查出是哪些大文件占了空间，能不能清理？' }],
      'agent',
      {
        servers: mockServers as any,
        activeServerId: 'srv-1',
      },
    )

    expect(callCount).toBe(3)
    expect(res.executedTools).toHaveLength(2)
    expect(res.executedTools?.[0].command).toBeDefined()
    expect(res.executedTools?.[1].command).toContain('du -sh /tmp/*')
    expect(res.content).not.toContain('<function')
    expect(res.content).not.toContain('<parameter')
    expect(res.content).toContain('qshell_test_bloat.log')
    expect(res.commands).toHaveLength(1)
    expect(res.commands[0].command).toBe('rm -f /tmp/qshell_test_bloat.log')
  })

  it('supports Anthropic protocol with ModelScope ms- token and dual headers', async () => {
    let capturedUrl = ''
    let capturedHeaders: Record<string, string> = {}
    let capturedBody: any = null

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      capturedBody = init?.body ? JSON.parse(init.body as string) : null
      return {
        ok: true,
        json: async () => ({
          content: [{ text: 'Hello from ModelScope Anthropic!' }],
        }),
      }
    })

    const modelscopeAnthropicSettings: AISettings = {
      provider: 'modelscope',
      protocol: 'anthropic',
      baseUrl: 'https://api-inference.modelscope.cn',
      apiKey: 'ms-0a8f9b1c2d3e4f5a6b7c8d9e0f',
      model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: false,
      maskPrivateIps: false,
    }

    const testRes = await testConnection(modelscopeAnthropicSettings)
    expect(testRes.success).toBe(true)
    expect(capturedUrl).toBe('https://api-inference.modelscope.cn/v1/messages')
    expect(capturedHeaders['x-api-key']).toBe('ms-0a8f9b1c2d3e4f5a6b7c8d9e0f')
    expect(capturedHeaders['Authorization']).toBe('Bearer ms-0a8f9b1c2d3e4f5a6b7c8d9e0f')
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01')
    expect(capturedBody.model).toBe('Qwen/Qwen2.5-Coder-32B-Instruct')
  })

  it('sanitizes sensitive secrets in tool output before sending to model when DLP is enabled', async () => {
    let capturedToolMsgContent = ''
    let callCount = 0

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount++
      const body = init?.body ? JSON.parse(init.body as string) : {}
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '正在查询应用配置',
                  tool_calls: [
                    {
                      id: 'call_config_1',
                      type: 'function',
                      function: {
                        name: 'probe_server',
                        arguments: JSON.stringify({ metric: 'memory' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        }
      } else {
        const toolMsg = body.messages?.find((m: any) => m.role === 'tool')
        capturedToolMsgContent = toolMsg?.content || ''
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '已完成分析。',
                },
              },
            ],
          }),
        }
      }
    })

    const dlpSettings: AISettings = {
      ...baseSettings,
      enableDlp: true,
      maskPrivateIps: true,
    }

    await sendAssistantChat(
      dlpSettings,
      [{ role: 'user', content: '查看内存' }],
      'agent',
      {
        servers: [
          {
            id: 'srv-1',
            name: '测试机',
            host: '10.0.0.5',
            port: 22,
            username: 'root',
            authType: 'password',
            targetType: 'linux',
            status: 'online',
          },
        ] as any,
        activeServerId: 'srv-1',
      },
    )

    expect(callCount).toBe(2)
    // When maskPrivateIps is enabled, any private IPs in probe output are masked
    expect(capturedToolMsgContent).not.toContain('10.0.0.5')
  })
})

