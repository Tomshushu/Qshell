/**
 * packages/qshell-policy/src/schema.ts
 *
 * 对齐 MCP Tool Schema 规范与 annotations 标准元数据 (S1-2)
 */

export interface McpToolAnnotation {
  readOnlyHint: boolean
  idempotentHint: boolean
  openWorldHint?: boolean
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties?: boolean
  }
  annotations?: McpToolAnnotation
}

/**
 * 1. probe_server (轻量只读指标探针)
 */
export const PROBE_SERVER_SCHEMA: McpToolDefinition = {
  name: 'probe_server',
  description:
    '秒级只读探测纳管主机全景指标：内存、CPU、磁盘挂载、运行容器、监听端口。不修改任何状态。',
  inputSchema: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        enum: ['memory', 'cpu', 'disk', 'container', 'network', 'process', 'all'],
        description:
          '探测维度：memory(内存及Top进程), cpu(负载及Top进程), disk(核心分区挂载容量), container(运行容器), network(端口监听), process(进程列表), all(全景综合指标)',
      },
      hostId: {
        type: 'string',
        description: '纳管主机 ID，可从 qshell://hosts 获取',
      },
      targetServer: {
        type: 'string',
        description: '目标服务器名称或主机 IP。若不传则默认探测当前工作区连接的活动服务器。',
      },
    },
    required: ['metric'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
}

/**
 * 2. execute_readonly_command (单条只读排障指令)
 */
export const EXECUTE_READONLY_COMMAND_SCHEMA: McpToolDefinition = {
  name: 'execute_readonly_command',
  description:
    '在指定纳管主机执行单条只读排障命令。所有命令经 Qshell 零信任网关逐段审查；写、删、kill、重启、子 Shell、后台脱钩一律拒绝。返回经端侧 DLP 脱敏并截断至 8KB 的结果。',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          '拟执行的单条只读排障命令，如 systemctl status nginx、ss -tulpn | grep 8080、journalctl -u app -n 50 --no-pager 等',
      },
      hostId: {
        type: 'string',
        description: '纳管主机 ID',
      },
      targetServer: {
        type: 'string',
        description: '目标服务器名称或主机 IP，可选兼容字段',
      },
      explanation: {
        type: 'string',
        description: '执行该命令的排查目的说明',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
}

/**
 * 3. sftp_read_file (S1-5 SFTP 只读配置文件抓取)
 */
export const SFTP_READ_FILE_SCHEMA: McpToolDefinition = {
  name: 'sftp_read_file',
  description:
    '通过既有 SFTP 通道只读抓取远程配置文件，避免 Shell 转义与编码问题。仅允许白名单路径，返回脱敏并截断的文本。',
  inputSchema: {
    type: 'object',
    properties: {
      remotePath: {
        type: 'string',
        description: '绝对 POSIX 路径，例如 /etc/nginx/nginx.conf、/etc/systemd/system/app.service 等',
      },
      hostId: {
        type: 'string',
        description: '纳管主机 ID',
      },
      targetServer: {
        type: 'string',
        description: '目标服务器名称或主机 IP，可选兼容字段',
      },
      maxLines: {
        type: 'integer',
        default: 150,
        maximum: 500,
        description: '最大读取行数，默认 150 行，上限 500 行',
      },
    },
    required: ['remotePath'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
}

/**
 * Qshell 内置工具策略的「静态工具」清单（供 AI Agent 与策略引擎共用）。
 *
 * 注意：这不是 AI Agent 运行时的完整工具集。插件中心动态发现的 MCP 插件工具
 * （mcp__<plugin>__<tool>）由 buildMcpTools() 在运行时合并进来，
 * 不应在此处硬编码重复定义（Rust presets.rs 才是内置插件工具的唯一权威来源）。
 */
export const MCP_TOOLS: McpToolDefinition[] = [
  PROBE_SERVER_SCHEMA,
  EXECUTE_READONLY_COMMAND_SCHEMA,
  SFTP_READ_FILE_SCHEMA,
]

/**
 * 运行时动态插件工具的精简描述。
 * 与 src/services/api/types.ts 的 ActiveMcpTool 结构兼容，避免策略包反向依赖前端类型。
 */
export interface DynamicMcpToolDescriptor {
  qualifiedName: string
  toolName: string
  description: string
  inputSchema: Record<string, unknown>
  isReadOnly: boolean
  pluginName?: string
  transport?: string
}

/**
 * 将动态插件工具规范化为符合 MCP Tool Schema 的定义。
 *
 * 外部 MCP Server 返回的 inputSchema 质量参差不齐（缺 type / properties / required、
 * required 含非字符串项等），直接下发给大模型容易触发 400。这里统一补齐，
 * 并根据只读标记生成标准 annotations，让策略层与执行层使用同一份判定依据。
 */
export function toMcpToolDefinition(tool: DynamicMcpToolDescriptor): McpToolDefinition {
  const rawSchema = (tool.inputSchema || {}) as Record<string, unknown>
  const rawProperties = rawSchema.properties
  const properties =
    rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties)
      ? (rawProperties as Record<string, unknown>)
      : {}
  const required = Array.isArray(rawSchema.required)
    ? rawSchema.required.filter((item): item is string => typeof item === 'string')
    : []

  return {
    name: tool.qualifiedName || tool.toolName,
    description: tool.description || tool.toolName,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: rawSchema.additionalProperties !== false,
    },
    annotations: {
      readOnlyHint: tool.isReadOnly,
      // 写操作不可假定幂等；只读工具才标记幂等
      idempotentHint: tool.isReadOnly,
      // 本地子进程 / 远程端点对外部世界开放，ssh_native 内置工具只访问已纳管主机
      openWorldHint: (tool.transport || 'ssh_native') !== 'ssh_native',
    },
  }
}

/**
 * 构建完整工具清单：3 个静态内置工具 + 当前已启用的动态插件工具。
 * 同名工具以静态内置为准，避免插件伪造 probe_server 等受保护工具名。
 */
export function buildMcpTools(
  dynamicTools: DynamicMcpToolDescriptor[] = [],
): McpToolDefinition[] {
  const seen = new Set(MCP_TOOLS.map((tool) => tool.name))
  const merged: McpToolDefinition[] = [...MCP_TOOLS]

  for (const tool of dynamicTools) {
    const definition = toMcpToolDefinition(tool)
    if (!definition.name || seen.has(definition.name)) continue
    seen.add(definition.name)
    merged.push(definition)
  }

  return merged
}
