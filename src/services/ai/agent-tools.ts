/**
 * src/services/ai/agent-tools.ts
 *
 * Qshell AI Agent 原生工具调用定义与执行引擎 (Option A: Function Calling)
 * 1. 规范注册 probe_server 与 execute_readonly_command 工具
 * 2. 所有工具调用严格接入 Option C Command Guard 安全网关，只读放行，写操作绝不越界
 * 3. 动态支持目标服务器解析与连接池复用
 */

import { backend } from '@/services/api'
import { useAppStore } from '@/store'
import type { Server, ServerGroup } from '@/types'
import {
  executeSafeProbe,
  formatProbeReportForAI,
  SAFE_PROBE_COMMANDS,
  findActiveConnectionId,
  type ProbeMetricType,
} from './server-probe-service'
import {
  evaluateCommandForExecution,
  wrapSafeInspectionCommand,
} from './command-guard'

/**
 * 符合 OpenAI / DeepSeek / 通义千问等主流大模型的 Tools 规范定义
 */
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'probe_server',
      description:
        '对目标服务器执行只读安全探针，获取指定维度的实时运行水位数据（绝无写操作或深度递归，耗时约1~2s）。',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            enum: ['memory', 'cpu', 'disk', 'container', 'network', 'process', 'all'],
            description:
              '探测维度：memory(内存及Top进程), cpu(负载及Top进程), disk(核心分区挂载容量), container(运行容器), network(端口监听), process(进程列表), all(全景综合指标)',
          },
          targetServer: {
            type: 'string',
            description: '目标服务器名称或主机 IP。若不传则默认探测当前工作区连接的活动服务器。',
          },
        },
        required: ['metric'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_readonly_command',
      description:
        '在目标服务器上安全执行单条只读检查排障命令（必须严格属于只读白名单，如 systemctl status nginx, journalctl -n 50, cat /etc/hosts 等）。严禁包含 rm, kill, reboot, 写重定向等修改破坏操作。',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '拟执行的只读命令，如 systemctl status nginx 或 ss -tulpn | grep 8080',
          },
          explanation: {
            type: 'string',
            description: '执行该命令的排查目的说明',
          },
          targetServer: {
            type: 'string',
            description: '目标服务器名称或主机 IP，可选',
          },
        },
        required: ['command'],
      },
    },
  },
]

export interface AgentToolExecutionContext {
  servers: Server[]
  serverGroups: ServerGroup[]
  activeServerId: string | null
  customBlacklist?: string[]
  signal?: AbortSignal
}

export interface AgentToolExecutionResult {
  success: boolean
  output: string
  rawTerminalOutput?: string
  commandRan?: string
  explanation?: string
}

export interface ExtractedToolCall {
  id: string
  name: string
  arguments: string
}

/**
 * 规范化工具名称，自动防御流式 Token 拼接重复（如 probe_serverprobe_server）或代理非标准包装
 */
export function normalizeToolName(toolName: string): string {
  const trimmed = (toolName || '').trim()
  if (trimmed.includes('probe_server')) return 'probe_server'
  if (trimmed.includes('execute_readonly_command')) return 'execute_readonly_command'
  return trimmed
}

/**
 * 统一工具调用双协议提取器：
 * 兼容 OpenAI 标准 JSON 协议、通义千问 (Qwen) <function=...> XML 格式、<tool_call> 标签格式
 */
export function extractTextToolCalls(content: string): ExtractedToolCall[] {
  if (!content) return []
  const calls: ExtractedToolCall[] = []

  // 1. Qwen/通义千问格式: <function=NAME>\n<parameter=KEY>\nVAL\n... (</function>)?
  const funcRegex = /<function=([\w_]+)>([\s\S]*?)(?:<\/function>|(?=<function=)|$)/gi
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(content)) !== null) {
    const rawName = match[1].trim()
    const body = match[2]
    const args: Record<string, string> = {}
    const paramRegex = /<parameter=([\w_]+)>([\s\S]*?)(?=<parameter=|<\/function>|$)/gi
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      const key = paramMatch[1].trim()
      const val = paramMatch[2].replace(/<\/parameter>/gi, '').trim()
      if (key && val) {
        args[key] = val
      }
    }

    if (rawName && (Object.keys(args).length > 0 || rawName.includes('probe') || rawName.includes('command'))) {
      calls.push({
        id: `call_txt_${Date.now()}_${calls.length}`,
        name: normalizeToolName(rawName),
        arguments: JSON.stringify(args),
      })
    }
  }

  // 2. 通用 <tool_call> JSON 格式
  const toolCallRegex = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/gi
  while ((match = toolCallRegex.exec(content)) !== null) {
    const body = match[1].trim()
    try {
      const parsed = JSON.parse(body)
      if (parsed.name) {
        calls.push({
          id: `call_tc_${Date.now()}_${calls.length}`,
          name: normalizeToolName(parsed.name),
          arguments:
            typeof parsed.arguments === 'object'
              ? JSON.stringify(parsed.arguments)
              : String(parsed.arguments || '{}'),
        })
      }
    } catch {
      // 容错处理
    }
  }

  return calls
}

/**
 * 彻底清洗 DeepSeek / Qwen / Claude 等模型输出的所有内部协议标签
 * 确保 UI 绝不泄露任何 <function=...>, <parameter=...>, <tool_call>, <|DSML|> 等内部通信代码
 */
export function stripAllToolCallMarkup(text: string): string {
  if (!text) return ''
  const cleaned = text
    .replace(/<function=[\w_]+>[\s\S]*?(?:<\/function>|(?=<function=)|$)/gi, '')
    .replace(/<parameter=[\w_]+>[\s\S]*?(?:<\/parameter>|(?=<parameter=)|$)/gi, '')
    .replace(/<\/?(?:function|parameter)[^>]*>/gi, '')
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '')
    .replace(/<\/?(?:tool_call|function_call|tool_calls)[^>]*>/gi, '')
    .replace(/<[|｜]DSML[|｜][\s\S]*?<\/[|｜]DSML[|｜]calls>/gi, '')
    .replace(/<[|｜]DSML[|｜][^>]*>/gi, '')
    .replace(/<\/[|｜]DSML[|｜][^>]*>/gi, '')
    .replace(/<[|｜][^>]*?[|｜]>/gi, '')
    .trim()

  // 若仅剩下孤立的 JSON 闭合括号或空白，直接置空
  if (/^[\s{}[\]\n\r,]+$/.test(cleaned)) {
    return ''
  }
  return cleaned
}

/**
 * 保持向后兼容的别名导出
 */
export const stripDsmlTags = stripAllToolCallMarkup

/**
 * Agent 工具执行总入口：严格通过只读白名单与超时保护，具备参数智能自愈
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolExecutionContext,
): Promise<AgentToolExecutionResult> {
  const { servers, activeServerId, customBlacklist = [], signal } = context
  const normName = normalizeToolName(toolName)

  // 参数智能自愈：若模型在调用 probe_server 时传入了 command（如千问在深入排查时将命令写在 probe_server 中），
  // 自动将执行路由降级自愈为 execute_readonly_command
  const hasCustomCommand = Boolean(args.command && typeof args.command === 'string' && args.command.trim())
  const effectiveToolName = normName === 'probe_server' && hasCustomCommand
    ? 'execute_readonly_command'
    : normName

  // 1. 定位目标服务器（优先使用 context，若为空则自动回退至 AppStore 当前活跃标签页连接）
  const appState = useAppStore.getState()
  const candidateServers =
    servers && servers.length > 0 ? servers : (appState.servers || [])
  const effectiveActiveServerId =
    activeServerId ||
    appState.tabs?.find((t) => t.id === appState.activeTabId)?.serverId ||
    null

  let targetServer: Server | undefined
  if (args.targetServer) {
    const rawTarget = String(args.targetServer).trim().toLowerCase()
    targetServer = candidateServers.find(
      (s) =>
        s.name.toLowerCase().includes(rawTarget) ||
        s.host.toLowerCase().includes(rawTarget) ||
        s.id === rawTarget,
    )
  }
  if (!targetServer && !args.targetServer && effectiveActiveServerId) {
    targetServer = candidateServers.find((s) => s.id === effectiveActiveServerId)
  }
  if (!targetServer) {
    if (candidateServers.length === 0) {
      return {
        success: false,
        output: '💡 **当前未连接任何活动服务器终端**\n\n当前工作区尚未纳管任何服务器资产，请先在首页添加主机并建立 SSH 连接。',
      }
    }

    const serverListFormatted = candidateServers
      .slice(0, 8)
      .map((s) => `- 🖥️ **${s.name || s.host}** (\`${s.host}\`)`)
      .join('\n')

    const notFoundReason = args.targetServer
      ? `未找到匹配名称或 IP 为「${args.targetServer}」的服务器资产。`
      : `系统检测到您当前未打开任何 SSH 终端标签页，且未明确指定目标主机。`

    return {
      success: false,
      output: `💡 **未找到对应的服务器或未连接终端**\n\n${notFoundReason}\n\n您当前已纳管以下资产：\n${serverListFormatted}\n\n👉 **操作建议**：请直接在下方快捷卡片中选择目标主机，或先打开终端连接。`,
    }
  }

  // 2. 处理 probe_server 工具
  if (effectiveToolName === 'probe_server') {
    const rawMetric = String(args.metric || 'all') as ProbeMetricType
    const metric: ProbeMetricType = [
      'memory',
      'cpu',
      'disk',
      'container',
      'network',
      'process',
      'all',
    ].includes(rawMetric)
      ? rawMetric
      : 'all'

    try {
      const probeResult = await executeSafeProbe([targetServer], metric, signal)
      const report = formatProbeReportForAI(probeResult, targetServer.name)

      let cmdKey = 'linuxAll'
      if (metric === 'memory') cmdKey = 'linuxMemory'
      else if (metric === 'cpu') cmdKey = 'linuxCpu'
      else if (metric === 'disk') cmdKey = 'linuxDisk'
      else if (metric === 'container') cmdKey = 'linuxContainer'
      else if (metric === 'network') cmdKey = 'linuxNetwork'
      else if (metric === 'process') cmdKey = 'linuxProcess'

      if (targetServer.targetType === 'windows') {
        cmdKey = cmdKey.replace('linux', 'windows')
      }

      const cmdRan =
        (SAFE_PROBE_COMMANDS as Record<string, string>)[cmdKey] || SAFE_PROBE_COMMANDS.linuxAll

      const rawTerminalOutput = probeResult.items?.[0]?.output || report

      return {
        success: probeResult.succeeded > 0,
        output: report,
        rawTerminalOutput,
        commandRan: cmdRan,
        explanation: `由 AI 智能 Agent 自主决策调用的【${metric}】只读安全探针`,
      }
    } catch (err: unknown) {
      return {
        success: false,
        output: `执行探针失败: ${(err as Error)?.message || '未知错误'}`,
      }
    }
  }

  // 3. 处理 execute_readonly_command 工具
  if (effectiveToolName === 'execute_readonly_command') {
    const rawCmd = String(args.command || '').trim()
    if (!rawCmd) {
      return { success: false, output: '错误：未提供需要执行的命令。' }
    }

    // 零信任 Command Guard 安全校验
    const decision = evaluateCommandForExecution(rawCmd, {
      customBlacklist,
      executionMode: 'auto_readonly',
    })

    if (!decision.allowed) {
      return {
        success: false,
        output: `[安全网关拦截] 指令「${rawCmd}」已被系统安全防护网拦截阻断。原因：${decision.blockedReason || decision.reason || '不在允许执行的只读白名单中'}`,
      }
    }

    const safeCmd = wrapSafeInspectionCommand(decision.suggestedSafeCommand || rawCmd)

    // 查找连接通道
    const appState = useAppStore.getState()
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = findActiveConnectionId(targetServer.id, tabs, connectedServers)
    if (!activeConnId && effectiveActiveServerId === targetServer.id) {
      activeConnId = targetServer.id
    }

    if (!activeConnId) {
      return {
        success: false,
        output: `[执行失败] 目标主机「${targetServer.name || targetServer.host}」当前未打开任何活跃的 SSH 终端会话，无法在远程下发执行指令。请先在工作区连接该主机。`,
        commandRan: safeCmd,
        explanation: String(args.explanation || '只读排障检查命令'),
      }
    }

    if (!backend?.ssh?.execute) {
      return {
        success: false,
        output: `[执行失败] 当前环境未连接桌面 SSH 执行引擎，无法下发远程只读指令。`,
        commandRan: safeCmd,
        explanation: String(args.explanation || '只读排障检查命令'),
      }
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('执行超时 (10s)')), 10000),
      )
      const execRes = await Promise.race([
        backend.ssh.execute(activeConnId, safeCmd),
        timeoutPromise,
      ])
      const stdout = execRes.stdout || ''
      const stderr = execRes.stderr || ''
      const output = (stdout || stderr || '（执行完成，输出为空）').trim()

      return {
        success: execRes.exitCode === 0,
        output,
        commandRan: safeCmd,
        explanation: String(args.explanation || '只读排障检查指令'),
      }
    } catch (err: unknown) {
      return {
        success: false,
        output: `执行异常: ${(err as Error)?.message || '网络或命令执行超时'}`,
        commandRan: safeCmd,
      }
    }
  }

  return {
    success: false,
    output: `未知工具名称: ${toolName}`,
  }
}
