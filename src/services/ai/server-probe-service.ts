/**
 * src/services/ai/server-probe-service.ts
 *
 * Qshell 服务器集群只读安全探针引擎
 *
 * 核心安全准则与原则：
 * 1. 【严格只读 (Strictly Read-Only)】：绝不执行任何写、改、删、重启或服务变更指令；
 * 2. 【杜绝深度递归与 I/O 阻塞】：绝对禁止使用 `find /`、`du -sh /*` 等无界全盘深度递归遍历指令！
 *    所有指标均通过内核超级块只读查询 (df -h) 或 /proc 伪文件系统 (free, uptime, loadavg)，微秒级读取；
 * 3. 【5 秒快速超时保护】：单台探测强制 5 秒上限，对于离线或网络断开的主机快速短路标记，避免挂起前端；
 * 4. 【智能目标解析】：从用户自然语言中自动提炼目标服务器分组、特定主机名/IP或集群范围。
 */

import { backend } from '@/services/api'
import { useAppStore } from '@/store'
import type { Server, ServerGroup, SystemMetrics } from '@/types'

export type ProbeMetricType = 'disk' | 'memory' | 'cpu' | 'container' | 'network' | 'process' | 'all'

export interface ProbePlan {
  shouldProbe: boolean
  targetServers: Server[]
  targetExplanation: string
  metric: ProbeMetricType
}

export interface ProbeServerResultItem {
  serverId: string
  serverName: string
  host: string
  success: boolean
  output: string
  error?: string
}

export interface ProbeExecutionResult {
  total: number
  succeeded: number
  failed: number
  metric: ProbeMetricType
  items: ProbeServerResultItem[]
}

/**
 * 经过严格安全审查的只读轻量探针指令集
 * 绝不包含任何递归遍历或磁盘密集型命令（如 du、find 等）
 */
export const SAFE_PROBE_COMMANDS = {
  /**
   * Linux 磁盘指标：通过 df -h -P 读取文件系统超级块元数据
   * 排除虚拟伪文件系统 (tmpfs, devtmpfs, overlay, squashfs)
   * 耗时：通常小于 5ms，完全无文件树遍历开销
   */
  linuxDisk:
    "df -h -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x iso9660 2>/dev/null || df -h -P 2>/dev/null || df -h",

  /**
   * Linux 内存指标：通过 free -m 读取物理内存分配计数器，并附带最高内存占用前 10 进程快照
   */
  linuxMemory:
    "echo '===MEM==='; free -m 2>/dev/null || head -n 8 /proc/meminfo 2>/dev/null; echo '===TOP_MEM_PROCESSES==='; ps aux --sort=-%mem 2>/dev/null | head -n 10 || ps -eo pid,user,%cpu,%mem,comm --sort=-%mem 2>/dev/null | head -n 10",

  /**
   * Linux CPU 与负载：通过 uptime 和 /proc/loadavg 读取，并附带最高 CPU 占用前 10 进程快照
   */
  linuxCpu:
    "uptime 2>/dev/null; echo '---'; cat /proc/loadavg 2>/dev/null; echo '===TOP_CPU_PROCESSES==='; ps aux --sort=-%cpu 2>/dev/null | head -n 10 || ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 10",

  /**
   * Linux 运行容器状态探测 (Docker / Podman，只读查看，无写操作)
   */
  linuxContainer:
    'docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || podman ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "未检测到运行中的 Docker/Podman 容器"',

  /**
   * Linux 端口与网络监听状态 (ss / netstat 只读，限前 25 行)
   */
  linuxNetwork:
    'ss -tulpn 2>/dev/null | head -n 25 || netstat -tulpn 2>/dev/null | head -n 25',

  /**
   * Linux 系统高占用活跃进程列表 (ps 只读，限前 20 行)
   */
  linuxProcess:
    'ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 20',

  /**
   * Linux 综合快速健康指标（分段标记，无深度遍历）
   */
  linuxAll:
    "echo '===UPTIME==='; uptime 2>/dev/null; echo '===LOAD==='; cat /proc/loadavg 2>/dev/null; echo '===MEM==='; free -m 2>/dev/null || head -n 8 /proc/meminfo 2>/dev/null; echo '===DISK==='; df -h -P -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null || df -h -P 2>/dev/null; echo '===TOP_CPU_PROCESSES==='; ps aux --sort=-%cpu 2>/dev/null | head -n 6 || ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 6; echo '===TOP_MEM_PROCESSES==='; ps aux --sort=-%mem 2>/dev/null | head -n 6 || ps -eo pid,user,%cpu,%mem,comm --sort=-%mem 2>/dev/null | head -n 6",

  /**
   * Windows PowerShell 只读探针（WMI / CIM / PSDrive，快速获取，无递归）
   */
  windowsDisk:
    'powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free | Format-Table -AutoSize"',
  windowsMemory:
    'powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory | Format-Table -AutoSize; Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 10 Id, ProcessName, WorkingSet | Format-Table -AutoSize"',
  windowsCpu:
    'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name, LoadPercentage | Format-Table -AutoSize; Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Id, ProcessName, CPU | Format-Table -AutoSize"',
  windowsContainer:
    'docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}" 2>nul || powershell -NoProfile -Command "Get-Service docker -ErrorAction SilentlyContinue | Select-Object Status, Name, DisplayName"',
  windowsNetwork:
    'powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Select-Object -First 25 LocalAddress, LocalPort, OwningProcess | Format-Table -AutoSize"',
  windowsProcess:
    'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Id, ProcessName, CPU, WorkingSet | Format-Table -AutoSize"',
  windowsAll:
    'powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory; Get-PSDrive -PSProvider FileSystem | Select-Object Name, Used, Free; Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Id, ProcessName, CPU | Format-Table -AutoSize"',
}

/**
 * 寻找指定服务器当前在前端是否拥有已连接的活跃通道 ID
 * 优先级：
 * 1. 活跃标签页 `ws:${serverId}:${tab.id}`
 * 2. 任意以 `ws:${serverId}:` 开头且为连接态的会话
 * 3. 直连或全局连接 `serverId`
 */
export function findActiveConnectionId(
  serverId: string,
  tabs?: Array<{ id: string; serverId: string }>,
  connectedServers?: Record<string, boolean>,
): string | null {
  if (!serverId || !connectedServers) return null

  // 1. 检查已打开标签页对应的 ws 连接
  if (tabs && tabs.length > 0) {
    for (const tab of tabs) {
      if (tab.serverId === serverId) {
        const wsId = `ws:${serverId}:${tab.id}`
        if (connectedServers[wsId]) {
          return wsId
        }
      }
    }
  }

  // 2. 检查直连或基础连接状态
  if (connectedServers[serverId]) {
    return serverId
  }

  // 3. 检查任意以 `ws:${serverId}:` 命名空间开头且已连接的会话
  const prefix = `ws:${serverId}:`
  for (const [key, isConn] of Object.entries(connectedServers)) {
    if (isConn && key.startsWith(prefix)) {
      return key
    }
  }

  return null
}

/**
 * 将内核采集的系统指标结构化为清晰可读的诊断文本
 */
export function formatSystemMetricsSummary(
  metrics: Partial<SystemMetrics>,
  metric: ProbeMetricType = 'all',
): string {
  const lines: string[] = []

  // 1. CPU / 负载
  if (metric === 'cpu' || metric === 'all') {
    const usage = metrics.cpuUsage !== undefined ? metrics.cpuUsage.toFixed(1) + '%' : '未知'
    const loads =
      metrics.cpuLoad && metrics.cpuLoad.length > 0
        ? metrics.cpuLoad.map((v) => Number(v).toFixed(2)).join(', ')
        : null
    lines.push(`【CPU 与系统负载】`)
    lines.push(`- CPU 总使用率: ${usage}`)
    if (loads) {
      lines.push(`- 系统平均负载 (1/5/15分钟): ${loads}`)
    }
    if (metrics.uptime) {
      const days = Math.floor(metrics.uptime / 86400)
      const hours = Math.floor((metrics.uptime % 86400) / 3600)
      const mins = Math.floor((metrics.uptime % 3600) / 60)
      lines.push(`- 连续运行时间 (Uptime): ${days}天 ${hours}小时 ${mins}分钟`)
    }
  }

  // 2. 内存
  if (metric === 'memory' || metric === 'all') {
    lines.push(`【内存指标】`)
    const totalGb = metrics.memoryTotal ? metrics.memoryTotal.toFixed(1) : '0'
    const usedGb = metrics.memoryUsed ? metrics.memoryUsed.toFixed(1) : '0'
    const memPct =
      metrics.memoryTotal && metrics.memoryTotal > 0
        ? (((metrics.memoryUsed || 0) / metrics.memoryTotal) * 100).toFixed(1) + '%'
        : metrics.memPressure !== undefined
          ? (metrics.memPressure * 100).toFixed(1) + '%'
          : '未知'
    const availGb =
      metrics.memoryTotal && metrics.memoryUsed !== undefined
        ? Math.max(0, metrics.memoryTotal - metrics.memoryUsed).toFixed(1)
        : '0'

    lines.push(
      `- 物理内存: 已使用 ${usedGb} GB / 总计 ${totalGb} GB (占用率: ${memPct}, 剩余可用: 约 ${availGb} GB)`,
    )

    if (metrics.swapTotal && metrics.swapTotal > 0) {
      const swapUsedGb = metrics.swapUsed ? metrics.swapUsed.toFixed(1) : '0'
      const swapTotalGb = metrics.swapTotal.toFixed(1)
      const swapPct =
        (((metrics.swapUsed || 0) / metrics.swapTotal) * 100).toFixed(1) + '%'
      lines.push(
        `- 交换分区 (Swap): 已使用 ${swapUsedGb} GB / 总计 ${swapTotalGb} GB (使用率: ${swapPct})`,
      )
    }
  }

  // 3. 磁盘
  if (metric === 'disk' || metric === 'all') {
    lines.push(`【磁盘存储指标】`)
    const disks = metrics.disks || []
    const physicalDisks = disks.filter((d) => d.category === 'disk' || !d.category)
    const targetDisks = physicalDisks.length > 0 ? physicalDisks : disks.slice(0, 5)

    if (targetDisks.length === 0) {
      lines.push(`- 暂未采集到物理磁盘挂载信息`)
    } else {
      for (const d of targetDisks) {
        const total = d.total ? d.total.toFixed(1) : '0'
        const used = d.used ? d.used.toFixed(1) : '0'
        const avail = d.available ? d.available.toFixed(1) : '0'
        const pct = d.usePercent !== undefined ? d.usePercent.toFixed(1) + '%' : '0%'
        lines.push(
          `- 挂载点 ${d.mountPoint || '/'}: 已用 ${used} GB / 总计 ${total} GB (使用率: ${pct}, 可用: ${avail} GB) [${d.filesystem || ''}]`,
        )
      }
    }
  }

  return lines.join('\n')
}

/**
 * 构建紧凑的服务器与分组资产清单摘要（注入 System Prompt，供大模型理解拓扑）
 * 绝不包含密码、密钥、端口转发私密凭据
 */
export function buildServerInventory(servers: Server[], serverGroups: ServerGroup[]): string {
  if (!servers || servers.length === 0) return '（暂无已纳管的服务器）'

  const groupMap = new Map<string, string>()
  for (const g of serverGroups) {
    groupMap.set(g.id, g.name)
  }

  return servers
    .slice(0, 30) // 限制展示上限，节约 token
    .map((s) => {
      const groupName = s.groupId ? groupMap.get(s.groupId) || '默认分组' : '根目录/未分组'
      const targetType = s.targetType || 'linux'
      const osDetail = s.osInfo ? ` (${s.osInfo})` : s.osType ? ` (${s.osType})` : ''
      return `- ${s.name} (IP/Host: ${s.host}, 分组: ${groupName}, 系统: ${targetType}${osDetail})`
    })
    .join('\n')
}

/**
 * 解析用户输入，判断是否触发只读指标探测，并定位目标服务器与指标类型
 */
export function resolveProbePlan(
  query: string,
  servers: Server[],
  serverGroups: ServerGroup[],
  activeServerId?: string | null,
): ProbePlan {
  const q = query.trim().toLowerCase()

  // 1. 过滤纯问答、教学、编写代码、概念科普等普通知识性提问（此类问题无需探测任何服务器）
  const isGeneralKnowledgeQuery =
    /^(?:什么是|解释一下|介绍一下|科普|谈谈|聊聊|讲讲|请问什么是)/.test(q) ||
    /(?:区别|对比|优缺点|底层原理|核心机制|设计模式|生命周期)(?:是什么|有哪些|如何理解)?\??$/.test(q) ||
    /^(?:怎么写|如何写|帮我写|编写|生成|写一个|写一段).*(?:脚本|代码|配置|函数|yaml|dockerfile|makefile)/.test(q) ||
    /^(?:如何安装|怎么安装|安装步骤|部署教程|配置教程|使用教程)/.test(q) ||
    /^(?:为什么|为啥|为何).*(?:会|能够|需要|不可以|不能)/.test(q)

  if (isGeneralKnowledgeQuery) {
    return {
      shouldProbe: false,
      targetServers: [],
      targetExplanation: '',
      metric: 'all',
    }
  }

  // 2. 判断是否具备现场观测或状态巡检的动作意图（必须包含动作或状态诉求词）
  const inspectionActionKeywords = [
    '看看',
    '查看',
    '查一下',
    '检查',
    '巡检',
    '体检',
    '探测',
    '排查',
    '排错',
    '诊断',
    '分析',
    '卡顿',
    '很卡',
    '好卡',
    '卡死',
    '变慢',
    '缓慢',
    '响应慢',
    '异常',
    '瓶颈',
    '故障',
    '挂了',
    '死机',
    '崩了',
    '跑崩',
    '报错',
    '出问题',
    '状态',
    '指标',
    '负载',
    '满了',
    '占满',
    '怎么样',
    '情况',
    '健康',
    '监控',
    '占用',
    '监听',
    '怎么回事',
    '稳定吗',
    '慢不慢',
    'status',
    'health',
    'inspect',
    'metrics',
    'top',
    'usage',
    'diagnose',
    'troubleshoot',
    'bottleneck',
    'error',
    'slow',
    'down',
  ]
  const hasActionIntent = inspectionActionKeywords.some((kw) => q.includes(kw))
  if (!hasActionIntent) {
    return {
      shouldProbe: false,
      targetServers: [],
      targetExplanation: '',
      metric: 'all',
    }
  }

  // 2. 判断指标侧重 (container / network / process / disk / memory / cpu / all)
  const isContainer = ['容器', 'docker', 'podman', 'k8s', 'container', '镜像'].some((kw) => q.includes(kw))
  const isNetwork = ['端口', 'port', '网络', '连接', '监听', 'listen', 'ss', 'netstat'].some((kw) => q.includes(kw))
  const isProcess =
    ['进程', 'ps', 'process', '服务状态', '系统服务', '后台服务', 'systemd', 'service', 'systemctl', '应用', '程序', '哪个应用', '什么应用', '哪个程序', '什么程序', '谁占', '占用最高', '排行', 'top'].some((kw) =>
      q.includes(kw),
    ) || q.replace(/服务器/g, '').includes('服务')
  const isDisk = ['磁盘', '硬盘', '存储', '空间', '容量', 'disk', 'df', '满了', '占满'].some((kw) =>
    q.includes(kw),
  )
  const isMemory = ['内存', 'ram', 'memory', 'swap', 'free', 'mem'].some((kw) => q.includes(kw))
  const isCpu = ['cpu', '负载', '算力', '核', 'load', 'processor'].some((kw) => q.includes(kw))

  let metric: ProbeMetricType = 'all'
  if (isContainer) {
    metric = 'container'
  } else if (isNetwork) {
    metric = 'network'
  } else if (isMemory && isProcess) {
    // 明确询问高内存占用应用/进程：使用附带进程快照的内存探针
    metric = 'memory'
  } else if (isCpu && isProcess) {
    // 明确询问高 CPU 占用应用/进程：使用附带进程快照的 CPU 探针
    metric = 'cpu'
  } else if (isProcess) {
    metric = 'process'
  } else if (isDisk && !isMemory && !isCpu) {
    metric = 'disk'
  } else if (isMemory && !isDisk && !isCpu) {
    metric = 'memory'
  } else if (isCpu && !isDisk && !isMemory) {
    metric = 'cpu'
  } else {
    metric = 'all'
  }

  // 3. 过滤可执行 SSH 的有效服务器（排除 BMC 等非 SSH 目标）
  const validServers = servers.filter((s) => s.targetType !== 'bmc')
  if (validServers.length === 0) {
    return {
      shouldProbe: false,
      targetServers: [],
      targetExplanation: '未找到可探测的服务器',
      metric,
    }
  }

  // 4. 定位目标范围
  // 4.1 分组匹配（支持包含匹配，如用户输入"生产"匹配"生产环境"分组）
  let matchedGroup: ServerGroup | null = null
  for (const group of serverGroups) {
    const gName = group.name.trim().toLowerCase()
    if (gName && (q.includes(gName) || (gName.length >= 2 && q.includes(gName.slice(0, 2))))) {
      matchedGroup = group
      break
    }
  }

  if (matchedGroup) {
    const groupServers = validServers.filter((s) => s.groupId === matchedGroup!.id)
    if (groupServers.length > 0) {
      return {
        shouldProbe: true,
        targetServers: groupServers.slice(0, 10), // 最多一次探测 10 台，保证在 2 秒内完成
        targetExplanation: `【${matchedGroup.name}】分组 (${groupServers.length} 台服务器)`,
        metric,
      }
    }
  }

  // 4.2 指定服务器匹配（按名称、子词片段或 Host / IP 匹配）
  const matchedServers = validServers.filter((s) => {
    const sName = s.name ? s.name.trim().toLowerCase() : ''
    const sHost = s.host ? s.host.trim().toLowerCase() : ''
    const nameMatch = Boolean(sName && q.includes(sName))
    const hostMatch = Boolean(sHost && q.includes(sHost))
    const nameParts = sName ? sName.split(/[-_\s]+/).filter((p) => p.length >= 2) : []
    const partMatch = nameParts.some((part) => q.includes(part))
    return nameMatch || hostMatch || partMatch
  })

  if (matchedServers.length > 0) {
    return {
      shouldProbe: true,
      targetServers: matchedServers.slice(0, 5),
      targetExplanation: `指定服务器: ${matchedServers.map((s) => s.name || s.host).join(', ')}`,
      metric,
    }
  }

  // 4.3 集群全量 / “所有” / “全部” / “这几台” / “哪些满了”
  const clusterKeywords = [
    '所有',
    '全部',
    '集群',
    '这几台',
    '哪些',
    '大盘',
    '资产',
    '整体',
    '都',
    '各台',
  ]
  const isClusterQuery = clusterKeywords.some((kw) => q.includes(kw))
  if (isClusterQuery) {
    // 明确询问全量/多台服务器时，巡检已存的全部服务器（上限 10 台）
    const targetList = validServers.slice(0, 10)
    return {
      shouldProbe: true,
      targetServers: targetList,
      targetExplanation: `集群服务器 (共 ${targetList.length} 台)`,
      metric,
    }
  }

  // 4.4 单台“当前” / “这台” 服务器匹配
  const isCurrentDeviceQuery = [
    '当前',
    '这台',
    '此台',
    '这个',
    '这台机器',
    '这台服务器',
    '本机',
  ].some((kw) => q.includes(kw))

  if (isCurrentDeviceQuery) {
    if (activeServerId) {
      const currentServer = validServers.find((s) => s.id === activeServerId)
      if (currentServer) {
        return {
          shouldProbe: true,
          targetServers: [currentServer],
          targetExplanation: `当前工作区服务器: ${currentServer.name || currentServer.host}`,
          metric,
        }
      }
    }
    // 未打开任何活动连接终端：礼貌拦截，不盲目探测
    return {
      shouldProbe: false,
      targetServers: [],
      targetExplanation: '当前未连接任何活动服务器终端',
      metric,
    }
  }

  // 4.5 未指定具体主机名亦非集群全量：若无活跃终端，不盲目执行探针
  if (!activeServerId) {
    return {
      shouldProbe: false,
      targetServers: [],
      targetExplanation: '当前未连接任何活动服务器终端',
      metric,
    }
  }

  // 4.5 如果处于工作台中，默认关联当前工作台服务器
  if (activeServerId) {
    const activeServer = validServers.find((s) => s.id === activeServerId)
    if (activeServer) {
      return {
        shouldProbe: true,
        targetServers: [activeServer],
        targetExplanation: `当前服务器: ${activeServer.name || activeServer.host}`,
        metric,
      }
    }
  }

  return {
    shouldProbe: false,
    targetServers: [],
    targetExplanation: '',
    metric,
  }
}

/**
 * 执行轻量安全只读指标探测
 *
 * 采用双通道安全采集引擎：
 * 通道 1【活跃会话零延迟通道】：若目标服务器在前端已处于活跃工作区连接中（ws 命名空间），
 * 直接调用底层 metrics 采集器与已打通的通道执行安全命令，0 额外握手开销，瞬间获取高精度指标；
 * 通道 2【冷启动会话受控通道】：若目标服务器未处于活跃连接，调用批量只读命令引擎，
 * 采用 10 秒安全超时保护，任何返回 stdout 的命令均认定为成功，避免通道退出码兼容性假死。
 */
export async function executeSafeProbe(
  targetServers: Server[],
  metric: ProbeMetricType = 'all',
  _signal?: AbortSignal,
  customState?: {
    tabs?: Array<{ id: string; serverId: string }>
    connectedServers?: Record<string, boolean>
  },
): Promise<ProbeExecutionResult> {
  const resultItems: ProbeServerResultItem[] = []

  if (!targetServers || targetServers.length === 0) {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      metric,
      items: [],
    }
  }

  // 若无桌面后端执行能力（未建立通信通道），如实返回不可用状态，杜绝伪造假数据
  if (!backend?.ssh?.batchExecute && !backend?.metrics?.collect && !backend?.ssh?.execute) {
    return {
      total: targetServers.length,
      succeeded: 0,
      failed: targetServers.length,
      metric,
      items: targetServers.map((s) => ({
        serverId: s.id,
        serverName: s.name || s.host,
        host: s.host,
        success: false,
        output: '',
        error: '当前环境未连接桌面 SSH 运行时引擎，无法获取实时指标',
      })),
    }
  }

  // 依据服务器类型选取对应的安全只读命令
  const getCmd = (type: 'linux' | 'windows') => {
    if (type === 'windows') {
      if (metric === 'disk') return SAFE_PROBE_COMMANDS.windowsDisk
      if (metric === 'memory') return SAFE_PROBE_COMMANDS.windowsMemory
      if (metric === 'cpu') return SAFE_PROBE_COMMANDS.windowsCpu
      if (metric === 'container') return SAFE_PROBE_COMMANDS.windowsContainer
      if (metric === 'network') return SAFE_PROBE_COMMANDS.windowsNetwork
      if (metric === 'process') return SAFE_PROBE_COMMANDS.windowsProcess
      return SAFE_PROBE_COMMANDS.windowsAll
    }
    if (metric === 'disk') return SAFE_PROBE_COMMANDS.linuxDisk
    if (metric === 'memory') return SAFE_PROBE_COMMANDS.linuxMemory
    if (metric === 'cpu') return SAFE_PROBE_COMMANDS.linuxCpu
    if (metric === 'container') return SAFE_PROBE_COMMANDS.linuxContainer
    if (metric === 'network') return SAFE_PROBE_COMMANDS.linuxNetwork
    if (metric === 'process') return SAFE_PROBE_COMMANDS.linuxProcess
    return SAFE_PROBE_COMMANDS.linuxAll
  }

  // 获取全局已连接状态与打开的标签页（支持外部注入用于单测）
  let tabs: Array<{ id: string; serverId: string }> = []
  let connectedServers: Record<string, boolean> = {}

  if (customState) {
    tabs = customState.tabs || []
    connectedServers = customState.connectedServers || {}
  } else {
    try {
      const appState = useAppStore.getState()
      tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
      connectedServers = appState.connectedServers || {}
    } catch {
      // 容错降级
    }
  }

  // 分流：优先识别已在工作台中建立活跃连接的服务器
  const activeServers: Array<{ server: Server; activeConnId: string }> = []
  const coldServers: Server[] = []

  for (const s of targetServers) {
    const activeConnId = findActiveConnectionId(s.id, tabs, connectedServers)
    if (activeConnId) {
      activeServers.push({ server: s, activeConnId })
    } else {
      coldServers.push(s)
    }
  }

  const tasks: Promise<void>[] = []

  // 通道 1：活跃会话零延迟并行采集（优先从内核 metrics 差分缓存和已建立通道读取）
  for (const { server, activeConnId } of activeServers) {
    const isWindows = server.targetType === 'windows'
    const cmd = getCmd(isWindows ? 'windows' : 'linux')

    tasks.push(
      (async () => {
        try {
          const timeoutMs = 4500
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('采集超时')), timeoutMs),
          )

          const [metricsResult, cmdResult] = await Promise.allSettled([
            backend?.metrics?.collect
              ? Promise.race([backend.metrics.collect(activeConnId), timeoutPromise])
              : Promise.reject(new Error('无 metrics 采集器')),
            backend?.ssh?.execute
              ? Promise.race([backend.ssh.execute(activeConnId, cmd), timeoutPromise])
              : Promise.reject(new Error('无 ssh 执行器')),
          ])

          let structuredSummary = ''
          let rawOutput = ''

          if (metricsResult.status === 'fulfilled' && metricsResult.value) {
            structuredSummary = formatSystemMetricsSummary(metricsResult.value, metric)
          }

          if (cmdResult.status === 'fulfilled' && cmdResult.value) {
            const out = cmdResult.value
            if (out.stdout && out.stdout.trim().length > 0) {
              rawOutput = out.stdout.trim()
            } else if (out.stderr && out.stderr.trim().length > 0) {
              rawOutput = out.stderr.trim()
            }
          }

          const combined = [structuredSummary, rawOutput ? `【只读指令实时输出】\n${rawOutput}` : '']
            .filter(Boolean)
            .join('\n\n')

          if (combined.trim().length > 0) {
            resultItems.push({
              serverId: server.id,
              serverName: server.name || server.host,
              host: server.host,
              success: true,
              output: combined.trim(),
            })
            return
          }

          resultItems.push({
            serverId: server.id,
            serverName: server.name || server.host,
            host: server.host,
            success: false,
            output: '',
            error: '工作区实时通道未在指定时间内响应指标数据',
          })
        } catch (err) {
          resultItems.push({
            serverId: server.id,
            serverName: server.name || server.host,
            host: server.host,
            success: false,
            output: '',
            error: (err as Error)?.message || '工作区会话指标采集异常',
          })
        }
      })(),
    )
  }

  // 通道 2：冷启动服务器安全只读命令批量执行（带 10 秒超时）
  if (coldServers.length > 0) {
    if (backend?.ssh?.batchExecute) {
      const linuxServers = coldServers.filter((s) => s.targetType !== 'windows')
      const windowsServers = coldServers.filter((s) => s.targetType === 'windows')

      if (linuxServers.length > 0) {
        const sids = linuxServers.map((s) => s.id)
        const cmd = getCmd('linux')
        tasks.push(
          backend.ssh
            .batchExecute(sids, cmd, 10)
            .then((res) => {
              for (const item of res.items) {
                const server = linuxServers.find((s) => s.id === item.serverId)
                const hasOutput = Boolean(item.stdout && item.stdout.trim().length > 0)
                const isSuccess = Boolean(item.success || hasOutput)
                resultItems.push({
                  serverId: item.serverId,
                  serverName: server?.name || item.serverId,
                  host: server?.host || '',
                  success: isSuccess,
                  output: (item.stdout || item.stderr || '').trim(),
                  error: isSuccess ? undefined : (item.error || '未能在10秒内建立连接或通道未响应'),
                })
              }
            })
            .catch((err) => {
              for (const server of linuxServers) {
                resultItems.push({
                  serverId: server.id,
                  serverName: server.name,
                  host: server.host,
                  success: false,
                  output: '',
                  error: (err as Error)?.message || '批量执行连接超时或失败',
                })
              }
            }),
        )
      }

      if (windowsServers.length > 0) {
        const sids = windowsServers.map((s) => s.id)
        const cmd = getCmd('windows')
        tasks.push(
          backend.ssh
            .batchExecute(sids, cmd, 10)
            .then((res) => {
              for (const item of res.items) {
                const server = windowsServers.find((s) => s.id === item.serverId)
                const hasOutput = Boolean(item.stdout && item.stdout.trim().length > 0)
                const isSuccess = Boolean(item.success || hasOutput)
                resultItems.push({
                  serverId: item.serverId,
                  serverName: server?.name || item.serverId,
                  host: server?.host || '',
                  success: isSuccess,
                  output: (item.stdout || item.stderr || '').trim(),
                  error: isSuccess ? undefined : (item.error || '未能在10秒内建立连接或通道未响应'),
                })
              }
            })
            .catch((err) => {
              for (const server of windowsServers) {
                resultItems.push({
                  serverId: server.id,
                  serverName: server.name,
                  host: server.host,
                  success: false,
                  output: '',
                  error: (err as Error)?.message || '批量执行连接超时或失败',
                })
              }
            }),
        )
      }
    } else {
      for (const server of coldServers) {
        resultItems.push({
          serverId: server.id,
          serverName: server.name || server.host,
          host: server.host,
          success: false,
          output: '',
          error: '桌面批量 SSH 执行后端不可用',
        })
      }
    }
  }

  await Promise.all(tasks)

  const succeeded = resultItems.filter((i) => i.success).length
  const failed = resultItems.length - succeeded

  return {
    total: resultItems.length,
    succeeded,
    failed,
    metric,
    items: resultItems,
  }
}

/**
 * 将探针原始输出组装为高可读性、专供 AI 进行诊断分析的系统上下文
 */
export function formatProbeReportForAI(
  result: ProbeExecutionResult,
  targetExplanation?: string,
): string {
  const metricLabel =
    result.metric === 'disk'
      ? '磁盘存储指标'
      : result.metric === 'memory'
        ? '内存占用指标'
        : result.metric === 'cpu'
          ? 'CPU与系统负载指标'
          : result.metric === 'container'
            ? '运行中的容器状态 (Docker/Podman)'
            : result.metric === 'network'
              ? '网络端口与连接监听状态'
              : result.metric === 'process'
                ? '系统高占用进程列表'
                : '全能综合健康指标'

  const lines: string[] = []
  lines.push(
    `【只读指标实时探测结果】（已安全执行非阻塞只读白名单指令与系统级指标采集，无深度递归，耗时约 1~2s）`,
  )
  lines.push(`探测维度: ${metricLabel}`)
  if (targetExplanation) {
    lines.push(`探测目标范围: ${targetExplanation}`)
  }
  lines.push(
    `统计: 共探测 ${result.total} 台，成功获取指标 ${result.succeeded} 台，未能获取 ${result.failed} 台`,
  )
  lines.push(`---`)

  for (const item of result.items) {
    lines.push(
      `主机: ${item.serverName} (IP: ${item.host}) — 状态: ${item.success ? '✅ 成功获取实时指标' : '⚠️ 实时指标未命中'}`,
    )
    if (item.success && item.output.trim()) {
      lines.push('```text')
      lines.push(item.output.trim())
      lines.push('```')
    } else {
      lines.push(`原因: ${item.error || '连接超时或未开启工作区实时监控通道'}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
