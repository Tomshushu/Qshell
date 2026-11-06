/**
 * src/services/ai/agent-tools.ts
 *
 * Qshell AI Agent 原生工具调用定义与执行引擎 (Option A: Function Calling + 外部 MCP Client 插件生态)
 * 1. 规范注册内置工具 (probe_server, execute_readonly_command, sftp_read_file) 与动态发现的外部 MCP 插件工具 (mcp__<plugin>__<tool>)
 * 2. 所有内置命令严格接入零信任 Command Guard 安全网关，只读放行，写操作绝不越界
 * 3. 动态支持目标服务器解析与连接池复用；外部 MCP 插件（K8s/Prometheus/Redis/PG 等）无需打开 SSH 终端即可跨系统联合取证
 * 4. 强制所有内置与外部 MCP 工具输出汇入 @qshell/policy 的 respond() 与 respondError() 管线（出向 DLP + 8KB 截断 + 统一审计落盘）
 */

import { backend, type ActiveMcpTool } from '@/services/api'
import { useAppStore } from '@/store'
import type { Server, ServerGroup } from '@/types'
import type { AIExecutionMode } from '@/types/ai'
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
  toMcpToolDefinition,
  type AdaptiveRetryPlan,
} from '@qshell/policy'
import { executeWithAdaptiveRetry } from './adaptive-command-executor'

/**
 * 统一解析目标服务器。
 *
 * 后端 ssh_batch_execute 在未连接时会用已保存的账号密码/密钥自动建连
 * （含直连、代理、跳板链），因此「打开终端窗口」不是执行前提；
 * 只需要确定查哪台主机：显式指定 > 活动终端 > 唯一纳管主机 > 提示指定。
 */
function resolveDiagnosticTargetServer(
  candidateServers: Server[],
  requestedTarget: unknown,
  effectiveActiveServerId: string | null,
): { server?: Server; error?: string } {
  const formatList = (list: Server[]) =>
    list
      .slice(0, 8)
      .map((s) => `- 🖥️ **${s.name || s.host}** (\`${s.host}\`)`)
      .join('\n')

  if (candidateServers.length === 0) {
    return {
      error:
        '💡 **尚无可用服务器资产**\n\n请先在首页添加主机。Qshell 会使用已保存的账号密码 / 密钥自动建立 SSH 连接，无需手动打开终端。',
    }
  }

  if (requestedTarget) {
    const rawTarget = String(requestedTarget).trim().toLowerCase()
    const matched = candidateServers.find(
      (s) =>
        s.name.toLowerCase().includes(rawTarget) ||
        s.host.toLowerCase().includes(rawTarget) ||
        s.id === rawTarget,
    )
    if (matched) return { server: matched }
    return {
      error: `💡 **未找到匹配的服务器**\n\n没有名称或 IP 匹配「${String(requestedTarget).trim()}」的主机。\n\n当前已纳管资产：\n${formatList(candidateServers)}\n\n👉 操作建议：请指定上述名称或 IP。`,
    }
  }

  if (effectiveActiveServerId) {
    const active = candidateServers.find((s) => s.id === effectiveActiveServerId)
    if (active) return { server: active }
  }

  // 只纳管一台主机时无需模型或用户额外指定，直接用它自动建连
  if (candidateServers.length === 1) return { server: candidateServers[0] }

  return {
    error: `💡 **请指定目标服务器**\n\n当前已纳管多台主机且未打开活动终端，请在问题中注明服务器名称或 IP（Qshell 会用已保存的凭据自动连接，无需打开终端）。\n\n当前已纳管资产：\n${formatList(candidateServers)}\n\n👉 操作建议：写明目标主机，或打开该主机的终端标签页。`,
  }
}

/**
 * 远程只读命令执行：优先复用已有 SSH 会话；没有会话时由后端 batchExecute
 * 用已保存的凭据自动建连执行，用户无需先打开终端窗口。
 */
async function runRemoteReadCommand(
  activeConnId: string | null,
  serverId: string,
  command: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; exitCode: number; error?: string }> {
  const withTimeout = async <T>(task: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`执行超时 (${Math.round(timeoutMs / 1000)}s)`)),
        timeoutMs,
      )
    })
    try {
      return await Promise.race([task, timeoutPromise])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // 1. 已有活跃会话时优先复用，会话失效则继续走自动建连
  if (activeConnId && backend?.ssh?.execute) {
    try {
      const res = await withTimeout(backend.ssh.execute(activeConnId, command))
      const isConnClosedErr =
        res &&
        res.exitCode !== 0 &&
        !res.stdout &&
        /^(Not connected|Connection lost|SSH connection failed|Channel open|Connection closed|SSH session|SSH error:|SSH send error|IO error:|Send failed)/i.test(
          res.stderr || '',
        )
      if (res && !isConnClosedErr) {
        return {
          stdout: res.stdout || '',
          stderr: res.stderr || '',
          exitCode: res.exitCode ?? 0,
        }
      }
    } catch {
      // 忽略会话级错误，交由后端用已保存凭据重新建连
    }
  }

  // 2. 无活跃终端会话：ssh_batch_execute 会使用已保存的账号密码 / 密钥自动建连
  if (backend?.ssh?.batchExecute) {
    const res = await withTimeout(
      backend.ssh.batchExecute(
        [serverId],
        command,
        Math.max(5, Math.round(timeoutMs / 1000)),
      ),
    )
    const item = res?.items?.[0]
    if (!item) throw new Error('批量执行引擎未返回目标主机结果')
    const stdout = item.stdout || ''
    return {
      stdout,
      stderr: item.stderr || '',
      exitCode: item.error
        ? -1
        : item.success || stdout.trim().length > 0
          ? 0
          : (item.exitCode ?? -1),
      error: item.error,
    }
  }

  throw new Error('当前环境未连接桌面 SSH 执行引擎')
}

/**
 * 带自动降级的远程只读执行：深度偏大的 find 若短超时未返回，
 * 会自动改用策略层给出的浅深度命令重试，结果中附带降级说明供 AI 解释。
 */
async function runRemoteReadCommandWithRetry(
  activeConnId: string | null,
  serverId: string,
  command: string,
  retryPlan?: AdaptiveRetryPlan,
  timeoutMs = 10000,
) {
  return executeWithAdaptiveRetry(
    command,
    retryPlan,
    (cmd, hardTimeoutMs) => runRemoteReadCommand(activeConnId, serverId, cmd, hardTimeoutMs),
    timeoutMs,
  )
}

/**
 * 符合 OpenAI / DeepSeek / 通义千问等主流大模型的内置 Tools 规范定义
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
            description: '可选。目标服务器名称或主机 IP。不填时使用活动终端对应主机，若只纳管一台主机则自动选取；Qshell 会用已保存的账号密码 / 密钥自动建连，无需先打开终端窗口。',
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
            description: '可选。目标服务器名称或主机 IP。不填时使用活动终端对应主机，若只纳管一台主机则自动选取；Qshell 会用已保存的账号密码 / 密钥自动建连，无需先打开终端窗口。',
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
            description: '可选。目标服务器名称或主机 IP。不填时使用活动终端对应主机，若只纳管一台主机则自动选取；Qshell 会用已保存的账号密码 / 密钥自动建连，无需先打开终端窗口。',
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
  /** 当前执行模式：由 AI 设置传入，缺省按只读自动执行（兼容旧调用） */
  executionMode?: AIExecutionMode
  signal?: AbortSignal
  /** 当前已激活的外部 MCP 工具映射表（qualifiedName -> ActiveMcpTool） */
  activeMcpToolsMap?: Map<string, ActiveMcpTool>
  /** 是否允许执行「包含状态变更操作」的 MCP 工具（默认拒绝，需用户在 AI 设置中显式授权） */
  allowWriteMcpTools?: boolean
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
 * 判断工具名称是否属于外部 MCP 插件工具
 */
export function isMcpToolName(toolName: string): boolean {
  return normalizeToolName(toolName).startsWith('mcp__')
}

/**
 * 动态加载当前所有已启用且握手成功的外部 MCP 插件工具，并转换为 OpenAI Function Calling 格式
 */
export async function loadActiveMcpTools(): Promise<{
  openAiTools: Array<Record<string, unknown>>
  activeToolsMap: Map<string, ActiveMcpTool>
  activeToolsList: ActiveMcpTool[]
}> {
  const activeToolsMap = new Map<string, ActiveMcpTool>()
  const openAiTools: Array<Record<string, unknown>> = []

  if (!backend?.mcpClient?.listActiveTools) {
    return { openAiTools, activeToolsMap, activeToolsList: [] }
  }

  try {
    const activeList = (await backend.mcpClient.listActiveTools()) || []
    for (const item of activeList) {
      if (!item?.qualifiedName) continue
      activeToolsMap.set(item.qualifiedName, item)

      // 动态插件工具的 schema 统一由 @qshell/policy 规范化，
      // 避免外部 MCP Server 返回的不合规 inputSchema 直接下发给大模型。
      const definition = toMcpToolDefinition({
        qualifiedName: item.qualifiedName,
        toolName: item.toolName,
        description: item.description,
        inputSchema: item.inputSchema,
        isReadOnly: item.isReadOnly,
        pluginName: item.pluginName,
        transport: item.transport,
      })

      openAiTools.push({
        type: 'function',
        function: {
          name: definition.name,
          description: `${definition.description}${item.isReadOnly ? ' [只读安全工具]' : ' [包含状态变更操作]'}`,
          parameters: definition.inputSchema,
        },
      })
    }
    return { openAiTools, activeToolsMap, activeToolsList: activeList }
  } catch {
    return { openAiTools, activeToolsMap, activeToolsList: [] }
  }
}

/**
 * 规范化工具名称，自动防御流式 Token 拼接重复（如 probe_serverprobe_server）或代理非标准包装
 */
export function normalizeToolName(toolName: string): string {
  const trimmed = (toolName || '').trim()
  if (trimmed.includes('probe_server')) return 'probe_server'
  if (trimmed.includes('execute_readonly_command')) return 'execute_readonly_command'
  if (trimmed.includes('sftp_read_file')) return 'sftp_read_file'
  const mcpMatch = trimmed.match(/(mcp__[a-zA-Z0-9_-]+)/)
  if (mcpMatch) return mcpMatch[1]
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
  const funcRegex = /<function=([\w_-]+)>([\s\S]*?)(?:<\/function>|(?=<function=)|$)/gi
  let match: RegExpExecArray | null
  while ((match = funcRegex.exec(content)) !== null) {
    const rawName = match[1].trim()
    const body = match[2]
    const args: Record<string, string> = {}
    const paramRegex = /<parameter=([\w_-]+)>([\s\S]*?)(?=<parameter=|<\/function>|$)/gi
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
        rawName.startsWith('mcp__') ||
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
    .replace(/<function=[\w_-]+>[\s\S]*?(?:<\/function>|(?=<function=)|$)/gi, '')
    .replace(/<parameter=[\w_-]+>[\s\S]*?(?:<\/parameter>|(?=<parameter=)|$)/gi, '')
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
 * 构建内置免配置 SSH-Native 专项排障插件的远端只读诊断脚本
 */
export function buildSshNativeDiagnosticPlan(
  _qualifiedName: string,
  toolMeta: ActiveMcpTool | undefined,
  args: Record<string, unknown>,
): { pluginLabel: string; toolName: string; command: string; explanation: string } | null {
  // 只有后端登记过的 builtin-* / ssh_native 插件才允许走 SSH 直连诊断。
  // 严禁根据工具名前缀反推插件身份：否则被用户禁用的工具、或外部插件的同名工具，
  // 都会绕过启用校验被当成内置 SSH 脚本执行。
  if (
    !toolMeta ||
    !toolMeta.pluginId.startsWith('builtin-') ||
    toolMeta.transport !== 'ssh_native'
  ) {
    return null
  }
  const toolName = toolMeta.toolName

  const sanitizeArg = (val: unknown, fallback = ''): string => {
    const raw = String(val ?? fallback).trim()
    return raw.replace(/[^a-zA-Z0-9_.:/@-]/g, '')
  }

  switch (toolName) {
    // 1. Docker 容器深度排障插件
    case 'inspect_abnormal_containers':
      return {
        pluginLabel: 'Docker 容器深度排障',
        toolName,
        explanation: '免配置扫描服务器异常退出容器、OOM 强杀状态与容器资源快照',
        command: `echo "=== [1] 异常/退出容器列表 ==="; docker ps -a --filter "status=exited" --filter "status=dead" --filter "status=restarting" --format "table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}" 2>/dev/null || true; echo "=== [2] 全部容器状态与资源占用 ==="; docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null | head -n 30; docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.MemPerc}}\\t{{.PIDs}}" 2>/dev/null | head -n 20 || true`,
      }
    case 'diagnose_container_detail': {
      const container = sanitizeArg(args.container || args.name || args.id)
      if (!container) return null
      return {
        pluginLabel: 'Docker 容器深度排障',
        toolName,
        explanation: `免配置深度诊断容器 ${container} 的退出码、OOMKilled 状态与最新日志`,
        command: `echo "=== [1] 容器核心状态 (ExitCode / OOMKilled / Error) ==="; docker inspect --format 'Name={{.Name}} Status={{.State.Status}} ExitCode={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Error={{.State.Error}} StartedAt={{.State.StartedAt}} FinishedAt={{.State.FinishedAt}} RestartCount={{.RestartCount}}' "${container}" 2>/dev/null || true; echo "=== [2] 端口映射与挂载目录 ==="; docker inspect --format 'Ports={{json .NetworkSettings.Ports}} Mounts={{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}' "${container}" 2>/dev/null || true; echo "=== [3] 最近 60 行容器日志 ==="; docker logs --tail 60 "${container}" 2>&1 || true`,
      }
    }
    case 'inspect_docker_network_and_storage':
      return {
        pluginLabel: 'Docker 容器深度排障',
        toolName,
        explanation: '免配置检查 Docker 网络网桥与磁盘空间占用',
        command: `echo "=== [1] Docker 网络网桥列表 ==="; docker network ls 2>/dev/null || true; echo "=== [2] Docker 磁盘空间占用 (docker system df) ==="; docker system df 2>/dev/null || true`,
      }

    // 2. Java / JVM 应用诊断插件
    case 'list_java_processes':
      return {
        pluginLabel: 'Java / JVM 应用诊断',
        toolName,
        explanation: '免配置扫描服务器上运行的 Java/JVM 进程、CPU/内存 RSS 及启动参数',
        command: `echo "=== [1] Java 进程资源排行 (PID / %CPU / %MEM / RSS / 启动参数) ==="; ps -eo pid,pcpu,pmem,rss,etime,args --sort=-pcpu | grep -E '[j]ava|[j]dk' | head -n 15 || echo "未检测到运行中的 Java 进程"; echo "=== [2] jps 虚拟机概览 ==="; jps -lvm 2>/dev/null | head -n 15 || true`,
      }
    case 'analyze_java_threads': {
      const pid = sanitizeArg(args.pid)
      if (!pid) return null
      return {
        pluginLabel: 'Java / JVM 应用诊断',
        toolName,
        explanation: `免配置提取 Java 进程 (PID: ${pid}) 高 CPU 线程堆栈与死锁检测`,
        command: `echo "=== [1] Java 进程 (${pid}) 高 CPU 线程 Top 10 ==="; ps -mp "${pid}" -o THREAD,tid,time 2>/dev/null | sort -k2 -r | head -n 12 || top -H -b -n 1 -p "${pid}" 2>/dev/null | head -n 20 || true; echo "=== [2] jstack 死锁检测与关键线程堆栈 ==="; (jstack -l "${pid}" 2>/dev/null || jcmd "${pid}" Thread.print 2>/dev/null) | grep -E -A 25 'deadlock|Deadlock|BLOCKED|RUNNABLE' | head -n 120 || true`,
      }
    }
    case 'inspect_jvm_memory_gc': {
      const pid = sanitizeArg(args.pid)
      if (!pid) return null
      return {
        pluginLabel: 'Java / JVM 应用诊断',
        toolName,
        explanation: `免配置采集 Java 进程 (PID: ${pid}) 堆内存各代占比与 GC 耗时统计`,
        command: `echo "=== [1] JVM GC 分代实时统计 (jstat -gcutil) ==="; jstat -gcutil "${pid}" 2>/dev/null || true; echo "=== [2] JVM 堆内存与系统物理内存状态 ==="; jcmd "${pid}" GC.heap_info 2>/dev/null || jmap -heap "${pid}" 2>/dev/null | head -n 45 || cat /proc/"${pid}"/status 2>/dev/null | grep -E 'Name|State|VmPeak|VmSize|VmRSS|Threads' || true`,
      }
    }

    // 3. Kubernetes (K8s) 排障插件
    case 'inspect_unhealthy_pods': {
      const ns = sanitizeArg(args.namespace)
      const nsFlag = ns ? `-n "${ns}"` : '--all-namespaces'
      return {
        pluginLabel: 'Kubernetes (K8s) 排障',
        toolName,
        explanation: '免配置扫描集群中非 Running 状态的异常 Pod 与最新告警事件',
        command: `echo "=== [1] 异常状态 Pod 列表 ==="; kubectl get pods ${nsFlag} --field-selector=status.phase!=Running,status.phase!=Succeeded -o wide 2>/dev/null || kubectl get pods ${nsFlag} 2>/dev/null | grep -vE 'Running|Completed' | head -n 30 || true; echo "=== [2] 近期集群 Warning 事件 ==="; kubectl get events ${nsFlag} --field-selector type=Warning --sort-by='.lastTimestamp' 2>/dev/null | tail -n 25 || true`,
      }
    }
    case 'diagnose_pod_detail': {
      const podName = sanitizeArg(args.podName || args.pod || args.name)
      if (!podName) return null
      const ns = sanitizeArg(args.namespace, 'default') || 'default'
      return {
        pluginLabel: 'Kubernetes (K8s) 排障',
        toolName,
        explanation: `免配置诊断 K8s Pod (${ns}/${podName}) 事件详情与崩溃日志`,
        command: `echo "=== [1] Pod 事件流与状态详情 (kubectl describe) ==="; kubectl describe pod "${podName}" -n "${ns}" 2>/dev/null | tail -n 65 || true; echo "=== [2] 上一次崩溃容器日志 (--previous) ==="; kubectl logs "${podName}" -n "${ns}" --previous --tail=40 2>/dev/null || true; echo "=== [3] 当前容器最新日志 ==="; kubectl logs "${podName}" -n "${ns}" --tail=50 2>&1 || true`,
      }
    }
    case 'inspect_k8s_nodes_and_workloads':
      return {
        pluginLabel: 'Kubernetes (K8s) 排障',
        toolName,
        explanation: '免配置检查 K8s 节点健康水位与工作负载副本就绪状态',
        command: `echo "=== [1] K8s 节点状态与资源水位 ==="; kubectl get nodes -o wide 2>/dev/null || true; kubectl top nodes 2>/dev/null || true; echo "=== [2] Deployment / StatefulSet 副本状态 ==="; kubectl get deploy,sts -A 2>/dev/null | head -n 40 || true`,
      }

    // 4. Nginx & Web 网关排障插件
    case 'inspect_web_gateway_status':
      return {
        pluginLabel: 'Nginx & Web 网关排障',
        toolName,
        explanation: '免配置检查 Nginx/Caddy/Apache 服务存活、监听端口与配置语法',
        command: `echo "=== [1] Web 网关服务与进程状态 ==="; systemctl status nginx openresty caddy httpd apache2 2>/dev/null | grep -E 'Loaded:|Active:|Main PID:' || ps -ef | grep -E '[n]ginx|[c]addy|[h]ttpd|[o]penresty' | head -n 15 || true; echo "=== [2] Web 网关监听端口 ==="; ss -tulpn | grep -E ':80\\b|:443\\b|:8080\\b|:8443\\b|nginx|caddy' | head -n 20 || true; echo "=== [3] Nginx 配置语法校验 ==="; nginx -t 2>&1 || true`,
      }
    case 'diagnose_5xx_and_upstream':
      return {
        pluginLabel: 'Nginx & Web 网关排障',
        toolName,
        explanation: '免配置提取 Nginx error.log 502/504 报错与 proxy_pass 上游路由配置',
        command: `echo "=== [1] 网关近期 Error 日志 ==="; tail -n 50 /var/log/nginx/error.log /usr/local/nginx/logs/error.log 2>/dev/null | tail -n 40 || journalctl -u nginx -n 40 --no-pager 2>/dev/null || true; echo "=== [2] 反向代理 proxy_pass 与 upstream 路由配置 ==="; grep -rnE 'server_name|proxy_pass|upstream' /etc/nginx/ /usr/local/nginx/conf/ 2>/dev/null | grep -vE '^\\s*#' | head -n 45 || true`,
      }
    case 'inspect_ssl_certificates':
      return {
        pluginLabel: 'Nginx & Web 网关排障',
        toolName,
        explanation: '免配置检查服务器上 Nginx 关联的 SSL 证书有效期与域名匹配情况',
        command: `echo "=== [1] SSL 证书有效期检查 ==="; for cert in $(grep -rhE 'ssl_certificate\\s+' /etc/nginx/ /usr/local/nginx/conf/ 2>/dev/null | awk '{print $2}' | tr -d ';' | sort -u | head -n 10); do if [ -f "$cert" ]; then echo "Certificate: $cert"; openssl x509 -in "$cert" -noout -subject -issuer -dates 2>/dev/null; fi; done`,
      }

    // 5. Linux 内核与网络诊断插件
    case 'inspect_oom_and_kernel_errors':
      return {
        pluginLabel: 'Linux 内核与网络诊断',
        toolName,
        explanation: '免配置检索内核 dmesg OOM Killer 强杀记录与硬件/文件系统报错',
        command: `echo "=== [1] 内核 OOM Killer 强杀记录 ==="; dmesg -T 2>/dev/null | grep -iE 'oom[-_]killer|out of memory|killed process' | tail -n 25 || grep -iE 'out of memory|killed process' /var/log/messages /var/log/syslog 2>/dev/null | tail -n 25 || echo "未发现内核 OOM 强杀记录"; echo "=== [2] 内核 I/O 与 Segfault 异常记录 ==="; dmesg -T 2>/dev/null | grep -iE 'I/O error|remount-ro|segfault|ext4-fs error|xfs_force_shutdown' | tail -n 20 || true`,
      }
    case 'diagnose_tcp_and_network':
      return {
        pluginLabel: 'Linux 内核与网络诊断',
        toolName,
        explanation: '免配置统计全机 TCP 连接状态分布、并发连接 Top 10 IP 与监听端口',
        command: `echo "=== [1] TCP 连接状态汇总 ==="; ss -s 2>/dev/null || true; ss -tan 2>/dev/null | awk 'NR>1 {++S[$1]} END {for(a in S) print a, S[a]}' | sort -k2 -nr || true; echo "=== [2] 并发连接数 Top 10 远端 IP ==="; ss -tn 2>/dev/null | awk 'NR>1 {print $5}' | sed 's/:[^:]*$//' | sort | uniq -c | sort -nr | head -n 10 || true; echo "=== [3] 核心监听端口 ==="; ss -tulpn 2>/dev/null | head -n 30 || true`,
      }
    case 'inspect_failed_services_and_zombies':
      return {
        pluginLabel: 'Linux 内核与网络诊断',
        toolName,
        explanation: '免配置扫描 systemd 异常失败服务、僵尸进程与磁盘 Inode 占用',
        command: `echo "=== [1] Systemd 异常失败服务 (systemctl --failed) ==="; systemctl --failed --no-pager 2>/dev/null || true; echo "=== [2] 僵尸进程 (Zombie) 扫描 ==="; ps -A -ostat,ppid,pid,cmd | grep -E '^[Zz]' | head -n 20 || echo "当前无僵尸进程"; echo "=== [3] 磁盘 Inode 使用率 (df -i) ==="; df -i -P 2>/dev/null | grep -vE 'tmpfs|devtmpfs|squashfs' || true`,
      }

    default:
      return null
  }
}

/**
 * 执行内置免配置 SSH-Native 排障插件或外部 MCP 插件工具，并强制汇入 @qshell/policy 的出向 DLP 脱敏、8KB 截断与审计管线
 */
async function executeExternalMcpTool(
  qualifiedName: string,
  args: Record<string, unknown>,
  context: AgentToolExecutionContext,
  startTime: number,
): Promise<AgentToolExecutionResult> {
  const isDangerMode = context.executionMode === 'danger'
  // 每次执行前重新读取后端权威清单：用户可能在对话过程中刚禁用插件/工具，
  // 不能信任请求开始时生成的 activeMcpToolsMap 快照（SSH-Native 分支会绕过 Rust call_tool）。
  let toolMeta = context.activeMcpToolsMap?.get(qualifiedName)
  if (backend?.mcpClient?.listActiveTools) {
    try {
      const list = await backend.mcpClient.listActiveTools()
      toolMeta = list.find((t) => t.qualifiedName === qualifiedName)
    } catch {
      // 后端不可用（浏览器/测试环境）时退回本轮快照
    }
  }

  if (!toolMeta) {
    const errRes = respondError(
      `安全策略拒绝：工具「${qualifiedName}」未注册或已被禁用，仅允许调用当前已启用的 MCP 插件工具。`,
      { tool: qualifiedName, durationMs: Date.now() - startTime, dangerous: isDangerMode },
    )
    return { success: false, output: errRes.content[0].text }
  }

  if (!toolMeta.isReadOnly && !context.allowWriteMcpTools && context.executionMode !== 'danger') {
    const errRes = respondError(
      `安全策略拒绝：插件工具「${qualifiedName}」包含状态变更操作，当前仅允许只读工具（仅在危险模式下放开插件写操作）。`,
      {
        tool: qualifiedName,
        hostId: `mcp:${toolMeta.pluginId}`,
        durationMs: Date.now() - startTime,
        dangerous: isDangerMode,
      },
    )
    return { success: false, output: errRes.content[0].text }
  }

  // 1. 仅内置 ssh_native 插件走 SSH 直连诊断，其余一律经 Rust MCP Client 调用
  const sshPlan = buildSshNativeDiagnosticPlan(qualifiedName, toolMeta, args || {})
  if (sshPlan) {
    const appState = useAppStore.getState()
    const candidateServers =
      context.servers && context.servers.length > 0
        ? context.servers
        : (appState.servers || [])
    const effectiveActiveServerId =
      context.activeServerId ||
      appState.tabs?.find((t) => t.id === appState.activeTabId)?.serverId ||
      null

    const resolved = resolveDiagnosticTargetServer(
      candidateServers,
      args?.targetServer,
      effectiveActiveServerId,
    )
    if (!resolved.server) {
      return { success: false, output: resolved.error || '未找到目标服务器' }
    }
    const targetServer = resolved.server

    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = findActiveConnectionId(targetServer.id, tabs, connectedServers)
    if (!activeConnId && effectiveActiveServerId === targetServer.id) {
      activeConnId = targetServer.id
    }

    const commandLabel = `[${sshPlan.pluginLabel}] ${sshPlan.toolName}`

    try {
      // 复用统一执行通道：无终端会话时自动用已保存凭据建连
      const execRes = await runRemoteReadCommand(
        activeConnId,
        targetServer.id,
        sshPlan.command,
        12000,
      )
      if (execRes.error) throw new Error(execRes.error)
      const rawOutput = (execRes.stdout || execRes.stderr || '（诊断完成，无输出）').trim()
      const execSuccess = execRes.exitCode === 0 || Boolean(execRes.stdout?.trim())

      const policyRes = respond(rawOutput, {
        tool: qualifiedName,
        hostId: targetServer.id,
        command: commandLabel,
        durationMs: Date.now() - startTime,
        dangerous: isDangerMode,
      })

      return {
        success: execSuccess,
        output: policyRes.content[0].text,
        rawTerminalOutput: rawOutput,
        commandRan: commandLabel,
        explanation: `${sshPlan.explanation}（目标主机：${targetServer.name || targetServer.host}）`,
      }
    } catch (err: unknown) {
      const errMsg = `执行专项诊断【${sshPlan.pluginLabel}】(${sshPlan.toolName}) 失败: ${(err as Error)?.message || String(err)}`
      const errPolicy = respondError(errMsg, {
        tool: qualifiedName,
        hostId: targetServer.id,
        command: commandLabel,
        durationMs: Date.now() - startTime,
        dangerous: isDangerMode,
      })
      return {
        success: false,
        output: errPolicy.content[0].text,
        commandRan: commandLabel,
      }
    }
  }

  // 2. 其他外部自定义 Stdio / HTTP MCP 插件工具走 Rust MCP Client 引擎
  if (!backend?.mcpClient?.callTool) {
    const errRes = respondError('当前环境未初始化 MCP Client 引擎，无法调用外部插件工具。', {
      tool: qualifiedName,
      durationMs: Date.now() - startTime,
      dangerous: isDangerMode,
    })
    return { success: false, output: errRes.content[0].text }
  }

  try {
    const callRes = await backend.mcpClient.callTool(
      toolMeta.pluginId,
      toolMeta.toolName,
      args || {},
    )
    const rawText = (callRes.text || '（MCP 工具执行完成，返回为空）').trim()
    // 审计只记录参数名，绝不把参数值（可能含 Token / 密码）写进日志
    const argKeys = Object.keys(args || {})
    const commandLabel = `[MCP:${toolMeta.pluginName}] ${toolMeta.toolName}(${argKeys.join(', ')})`

    if (callRes.isError) {
      const errPolicy = respondError(rawText, {
        tool: qualifiedName,
        hostId: `mcp:${toolMeta.pluginId}`,
        command: commandLabel,
        durationMs: callRes.durationMs || Date.now() - startTime,
        dangerous: isDangerMode,
      })
      return {
        success: false,
        output: errPolicy.content[0].text,
        rawTerminalOutput: rawText,
        commandRan: commandLabel,
        explanation: `调用外部 MCP 插件【${toolMeta.pluginName}】工具 ${toolMeta.toolName} 返回错误`,
      }
    }

    // 强制经过 S1 (@qshell/policy) 出向 DLP 脱敏与 8KB 截断管线
    const policyRes = respond(rawText, {
      tool: qualifiedName,
      hostId: `mcp:${toolMeta.pluginId}`,
      command: commandLabel,
      durationMs: callRes.durationMs || Date.now() - startTime,
      dangerous: isDangerMode,
    })

    return {
      success: true,
      output: policyRes.content[0].text,
      rawTerminalOutput: rawText,
      commandRan: commandLabel,
      explanation: `调用外部 MCP 插件【${toolMeta.pluginName}】工具 ${toolMeta.toolName}`,
    }
  } catch (err: unknown) {
    const errMsg = `调用 MCP 插件【${toolMeta.pluginName}】(${toolMeta.toolName}) 异常: ${(err as Error)?.message || String(err)}`
    const errPolicy = respondError(errMsg, {
      tool: qualifiedName,
      hostId: `mcp:${toolMeta.pluginId}`,
      durationMs: Date.now() - startTime,
      dangerous: isDangerMode,
    })
    return {
      success: false,
      output: errPolicy.content[0].text,
    }
  }
}

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
  const executionMode = context.executionMode || 'auto_readonly'
  const isDangerMode = executionMode === 'danger'

  // 模式裁决前置兜底：模型侧已按档控制工具下发，这里防止残留/伪造 tool call 绕过模式
  if (executionMode === 'ask' || executionMode === 'disabled') {
    const notice = executionMode === 'disabled'
      ? '当前为「只读问答」模式，AI 不会执行任何远程命令或插件工具。请在设置中切换执行模式，或手动在终端运行该命令。'
      : '当前为「询问确认」模式，AI 不会自动执行远程命令或插件工具。请在回复中的执行卡片上确认，或切换为「安全只读自动执行」模式。'
    return { success: false, output: notice }
  }

  const { servers, activeServerId, customBlacklist = [], signal } = context
  const normName = normalizeToolName(toolName)

  // 0. 优先路由外部 MCP 插件工具（mcp__<plugin>__<tool>）
  // 外部 MCP 工具（如 Kubernetes、Prometheus、Redis、PostgreSQL、GitHub、Fetch）
  // 直接通过 Rust MCP Client 引擎通信，不强依赖当前是否打开了 SSH 终端标签页
  if (normName.startsWith('mcp__')) {
    return executeExternalMcpTool(normName, args, context, startTime)
  }

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

  const resolved = resolveDiagnosticTargetServer(
    candidateServers,
    args.targetServer,
    effectiveActiveServerId,
  )
  if (!resolved.server) {
    return { success: false, output: resolved.error || '未找到目标服务器' }
  }
  const targetServer = resolved.server

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
        dangerous: isDangerMode,
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
        dangerous: isDangerMode,
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
        dangerous: isDangerMode,
      })
      return { success: false, output: errRes.content[0].text }
    }

    // 零信任 Command Guard 安全校验
    const decision = evaluateCommandForExecution(rawCmd, {
      customBlacklist,
      executionMode,
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
          dangerous: isDangerMode,
        },
      )
      return {
        success: false,
        output: blockedMsg,
      }
    }

    const safeCmd = wrapSafeInspectionCommand(decision.suggestedSafeCommand || rawCmd)

    // 优先复用已有会话；没有终端会话时由后端用已保存的账号密码 / 密钥自动建连
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = findActiveConnectionId(targetServer.id, tabs, connectedServers)
    if (!activeConnId && effectiveActiveServerId === targetServer.id) {
      activeConnId = targetServer.id
    }

    try {
      const execRes = await runRemoteReadCommandWithRetry(
        activeConnId,
        targetServer.id,
        safeCmd,
        decision.adaptiveRetry,
      )
      if (execRes.error) throw new Error(execRes.error)
      const rawOutput = (execRes.stdout || execRes.stderr || '（执行完成，输出为空）').trim()
      const noticeText = execRes.notice ? `${execRes.notice}\n\n` : ''
      const previewText = decision.preview ? `${decision.preview}\n\n` : ''
      const outputForAI = `${previewText}${noticeText}${rawOutput}`

      // 出向 DLP 脱敏与截断管线
      const policyRes = respond(outputForAI, {
        tool: 'execute_readonly_command',
        hostId: targetServer.id,
        command: safeCmd,
        verdict: decision.verdict,
        durationMs: Date.now() - startTime,
        dangerous: isDangerMode || Boolean(decision.isDangerous),
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
        dangerous: isDangerMode,
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
        dangerous: isDangerMode,
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
          dangerous: isDangerMode,
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
        executionMode,
      })

      if (!catDecision.allowed) {
        const fallbackBlockedMsg = `[降级失败] SFTP 无法读取且降级读取命令被拦截：${catDecision.blockedReason || catDecision.reason}`
        respondError(fallbackBlockedMsg, {
          tool: 'sftp_read_file',
          hostId: targetServer.id,
          remotePath: normalizedPath,
          dangerous: isDangerMode,
        })
        return {
          success: false,
          output: fallbackBlockedMsg,
        }
      }

      try {
        // 降级读取同样无需终端：后端会用已保存凭据自动建连
        const catRes = await runRemoteReadCommand(activeConnId, targetServer.id, safeCatCmd)
        if (!catRes.error && catRes.exitCode === 0) {
          fileContent = catRes.stdout || ''
        } else {
          const catFailMsg = `[读取失败] 远程文件读取失败：${catRes.error || catRes.stderr || '文件不存在或权限不足'}`
          respondError(catFailMsg, {
            tool: 'sftp_read_file',
            hostId: targetServer.id,
            remotePath: normalizedPath,
            dangerous: isDangerMode,
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
          dangerous: isDangerMode,
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
        dangerous: isDangerMode,
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
      dangerous: isDangerMode,
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
    dangerous: isDangerMode,
  })
  return {
    success: false,
    output: unknownMsg,
  }
}
