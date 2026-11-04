/**
 * src/services/ai/agent-tools.ts
 *
 * Qshell AI Agent 原生工具调用定义与执行引擎 (Option A: Function Calling / MCP Tools)
 * 1. 规范注册 probe_server, execute_readonly_command, sftp_read_file 工具
 * 2. 所有工具调用严格接入零信任 Command Guard 安全网关，只读放行，写操作绝不越界
 * 3. 动态支持目标服务器解析与连接池复用
 * 4. 强制所有工具执行与错误出口汇入 @qshell/policy 的 respond() 与 respondError() 管线（出向 DLP + 8KB 截断 + 统一审计落盘）
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
import {
  respond,
  respondError,
  validateSftpReadPath,
  isBinaryContent,
  clipFileLines,
} from '@qshell/policy'

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
        '在目标服务器上安全执行单条只读排障命令，用于现场实机取证（如查看服务存活 systemctl status/is-active、截取报错日志 journalctl -u app -n 50 --no-pager / tail -n 40 /var/log/nginx/error.log / docker logs --tail 50、检查去噪配置文件 grep -vE "^\\s*#|^\\s*$" /etc/nginx/conf.d/*.conf、排查端口监听 ss -tulpn | grep :8080、检查内核 OOM 强杀 dmesg -T | grep -i oom 等）。严禁包含 rm, kill, reboot, 写重定向等修改破坏操作。',
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
  {
    type: 'function',
    function: {
      name: 'sftp_read_file',
      description:
        '通过既有 SFTP 通道只读抓取远程配置文件，避免 Shell 转义与编码问题。仅允许白名单路径，返回经端侧 DLP 脱敏并截断至 8KB 的文本。',
      parameters: {
        type: 'object',
        properties: {
          remotePath: {
            type: 'string',
            description: '绝对 POSIX 路径，例如 /etc/nginx/nginx.conf、/etc/systemd/system/app.service 等',
          },
          targetServer: {
            type: 'string',
            description: '目标服务器名称或主机 IP，可选',
          },
          maxLines: {
            type: 'integer',
            description: '最大读取行数，默认 150 行，上限 500 行',
          },
        },
        required: ['remotePath'],
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
  if (trimmed.includes('sftp_read_file')) return 'sftp_read_file'
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

    if (
      rawName &&
      (Object.keys(args).length > 0 ||
        rawName.includes('probe') ||
        rawName.includes('command') ||
        rawName.includes('sftp') ||
        rawName.includes('file'))
    ) {
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
 * 统一所有出向返回经 respond / respondError 走 DLP 脱敏与 8KB 截断
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentToolExecutionContext,
): Promise<AgentToolExecutionResult> {
  const startTime = Date.now()
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

      // 出向 DLP 脱敏与截断管线
      const policyRes = respond(report, {
        tool: 'probe_server',
        hostId: targetServer.id,
        durationMs: Date.now() - startTime,
      })

      return {
        success: probeResult.succeeded > 0,
        output: policyRes.content[0].text,
        rawTerminalOutput,
        commandRan: cmdRan,
        explanation: `由 AI 智能 Agent 自主决策调用的【${metric}】只读安全探针`,
      }
    } catch (err: unknown) {
      const errRes = respondError((err as Error)?.message || '未知探针错误', {
        tool: 'probe_server',
        hostId: targetServer.id,
        durationMs: Date.now() - startTime,
      })
      return {
        success: false,
        output: errRes.content[0].text,
      }
    }
  }

  // 3. 处理 execute_readonly_command 工具
  if (effectiveToolName === 'execute_readonly_command') {
    const rawCmd = String(args.command || '').trim()
    if (!rawCmd) {
      const errRes = respondError('错误：未提供需要执行的命令。', {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
      })
      return { success: false, output: errRes.content[0].text }
    }

    // 零信任 Command Guard 安全校验
    const decision = evaluateCommandForExecution(rawCmd, {
      customBlacklist,
      executionMode: 'auto_readonly',
    })

    if (!decision.allowed) {
      const blockedMsg = `[安全网关拦截] 指令「${rawCmd}」已被系统安全防护网拦截阻断。原因：${decision.blockedReason || decision.reason || '不在允许执行的只读白名单中'}`
      respondError(
        {
          reason: decision.verdict?.reason || 'destructive',
          segment: decision.verdict?.segment || rawCmd,
          hint: decision.suggestedSafeCommand || '只读排障请使用只读命令（如 systemctl status, journalctl -n 50, ss -tulpn, docker ps 等）',
          message: blockedMsg,
        },
        {
          tool: 'execute_readonly_command',
          hostId: targetServer.id,
          command: rawCmd,
          durationMs: Date.now() - startTime,
        },
      )
      return {
        success: false,
        output: blockedMsg,
      }
    }

    const safeCmd = wrapSafeInspectionCommand(decision.suggestedSafeCommand || rawCmd)

    // 查找连接通道
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = findActiveConnectionId(targetServer.id, tabs, connectedServers)
    if (!activeConnId && effectiveActiveServerId === targetServer.id) {
      activeConnId = targetServer.id
    }

    if (!activeConnId) {
      const notConnMsg = `[执行失败] 目标主机「${targetServer.name || targetServer.host}」当前未打开任何活跃的 SSH 终端会话，无法在远程下发执行指令。请先在工作区连接该主机。`
      respondError(notConnMsg, {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
        command: safeCmd,
      })
      return {
        success: false,
        output: notConnMsg,
        commandRan: safeCmd,
        explanation: String(args.explanation || '只读排障检查命令'),
      }
    }

    if (!backend?.ssh?.execute) {
      const noEngineMsg = `[执行失败] 当前环境未连接桌面 SSH 执行引擎，无法下发远程只读指令。`
      respondError(noEngineMsg, {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
        command: safeCmd,
      })
      return {
        success: false,
        output: noEngineMsg,
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
      const rawOutput = (stdout || stderr || '（执行完成，输出为空）').trim()

      // 出向 DLP 脱敏与截断管线
      const policyRes = respond(rawOutput, {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
        command: safeCmd,
        verdict: decision.verdict,
        durationMs: Date.now() - startTime,
      })

      return {
        success: execRes.exitCode === 0,
        output: policyRes.content[0].text,
        commandRan: safeCmd,
        explanation: String(args.explanation || '只读排障检查指令'),
      }
    } catch (err: unknown) {
      const errMsg = `执行异常: ${(err as Error)?.message || '网络或命令执行超时'}`
      respondError(errMsg, {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
        command: safeCmd,
      })
      return {
        success: false,
        output: errMsg,
        commandRan: safeCmd,
      }
    }
  }

  // 4. 处理 sftp_read_file 工具 (S1-5 只读取证)
  if (effectiveToolName === 'sftp_read_file') {
    const rawPath = String(args.remotePath || args.path || '').trim()
    const maxLines = typeof args.maxLines === 'number' ? args.maxLines : 150

    if (!rawPath) {
      const errRes = respondError('错误：未提供需要读取的文件绝对路径。', {
        tool: 'sftp_read_file',
        hostId: targetServer.id,
      })
      return { success: false, output: errRes.content[0].text }
    }

    // 零信任路径合法性与白名单审查
    const validation = validateSftpReadPath(rawPath)
    if (!validation.valid) {
      const blockedMsg = `[安全网关拦截] 文件路径安全检查未通过：${validation.reason}`
      respondError(
        {
          reason: 'io-blocked',
          segment: rawPath,
          hint: '请提供白名单内绝对 POSIX 路径（如 /etc/nginx/nginx.conf、/var/log/syslog 等），且严禁包含 .. 或敏感凭据',
          message: blockedMsg,
        },
        {
          tool: 'sftp_read_file',
          hostId: targetServer.id,
          remotePath: rawPath,
          durationMs: Date.now() - startTime,
        },
      )
      return {
        success: false,
        output: blockedMsg,
      }
    }

    const normalizedPath = validation.normalizedPath!

    // 查找连接通道
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = findActiveConnectionId(targetServer.id, tabs, connectedServers)
    if (!activeConnId && effectiveActiveServerId === targetServer.id) {
      activeConnId = targetServer.id
    }

    let fileContent = ''
    let usedFallback = false

    // 4.1 优先使用 SFTP 既有通道读取
    try {
      if (backend?.files?.read) {
        const res = await backend.files.read(targetServer.id, normalizedPath)
        if (res && res.exitCode === 0 && typeof res.stdout === 'string') {
          fileContent = res.stdout
        } else {
          throw new Error(res?.stderr || 'SFTP 返回异常')
        }
      } else {
        throw new Error('当前环境未提供 SFTP 文件读取引擎')
      }
    } catch {
      // 4.2 降级路径：目标机未开 SFTP subsystem 时，fallback 到经 Guard 审查的只读 head / cat，并在审计标记 fallback=true
      usedFallback = true
      const safeCatCmd = `head -n ${Math.min(maxLines, 500)} "${normalizedPath}"`
      const catDecision = evaluateCommandForExecution(safeCatCmd, {
        customBlacklist,
        executionMode: 'auto_readonly',
      })

      if (!catDecision.allowed) {
        const fallbackBlockedMsg = `[降级失败] SFTP 无法读取且降级读取命令被拦截：${catDecision.blockedReason || catDecision.reason}`
        respondError(fallbackBlockedMsg, {
          tool: 'sftp_read_file',
          hostId: targetServer.id,
          remotePath: normalizedPath,
        })
        return {
          success: false,
          output: fallbackBlockedMsg,
        }
      }

      if (!backend?.ssh?.execute || !activeConnId) {
        const noConnMsg = `[读取失败] SFTP 无法读取且当前主机「${targetServer.name || targetServer.host}」未打开活跃终端会话以进行降级读取。`
        respondError(noConnMsg, {
          tool: 'sftp_read_file',
          hostId: targetServer.id,
          remotePath: normalizedPath,
        })
        return {
          success: false,
          output: noConnMsg,
        }
      }

      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('降级读取超时 (10s)')), 10000),
        )
        const catRes = await Promise.race([
          backend.ssh.execute(activeConnId, safeCatCmd),
          timeoutPromise,
        ])
        if (catRes.exitCode === 0) {
          fileContent = catRes.stdout || ''
        } else {
          const catFailMsg = `[读取失败] 远程文件读取失败：${catRes.stderr || '文件不存在或权限不足'}`
          respondError(catFailMsg, {
            tool: 'sftp_read_file',
            hostId: targetServer.id,
            remotePath: normalizedPath,
          })
          return {
            success: false,
            output: catFailMsg,
          }
        }
      } catch (err: unknown) {
        const errCatMsg = `[降级读取异常] ${(err as Error)?.message || '网络或命令执行超时'}`
        respondError(errCatMsg, {
          tool: 'sftp_read_file',
          hostId: targetServer.id,
          remotePath: normalizedPath,
        })
        return {
          success: false,
          output: errCatMsg,
        }
      }
    }

    // 4.3 二进制数据识别阻断
    if (isBinaryContent(fileContent)) {
      const binaryNotice = `[读取终止] 检测到目标文件「${normalizedPath}」为二进制数据或特殊编码文件，SFTP 只读取证工具仅支持文本格式的配置文件与日志读取。`
      respondError(binaryNotice, {
        tool: 'sftp_read_file',
        hostId: targetServer.id,
        remotePath: normalizedPath,
      })
      return {
        success: false,
        output: binaryNotice,
      }
    }

    // 4.4 行数安全修剪
    const { clippedText } = clipFileLines(fileContent, maxLines)

    // 4.5 出向 DLP 脱敏与 8KB 截断
    const policyRes = respond(clippedText, {
      tool: 'sftp_read_file',
      hostId: targetServer.id,
      remotePath: normalizedPath,
      durationMs: Date.now() - startTime,
    })

    return {
      success: true,
      output: policyRes.content[0].text,
      explanation: `通过 SFTP ${usedFallback ? '(降级 Shell 读取) ' : ''}只读获取配置文件：${normalizedPath}`,
    }
  }

  const unknownMsg = `未知工具名称: ${toolName}`
  respondError(unknownMsg, {
    tool: toolName,
  })
  return {
    success: false,
    output: unknownMsg,
  }
}
