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
 * 符合 MCP 与 OpenAI Function Calling 规范的工具清单
 */
export const MCP_TOOLS: McpToolDefinition[] = [
  PROBE_SERVER_SCHEMA,
  EXECUTE_READONLY_COMMAND_SCHEMA,
  SFTP_READ_FILE_SCHEMA,
]
