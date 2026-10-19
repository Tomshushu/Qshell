/**
 * src/services/ai/docker-diagnoser.ts
 *
 * Docker 容器异常退出即时归因与诊断引擎 (Docker Container Exit Code & OOM Diagnoser)
 *
 * 核心功能：
 * 1. 退出码精确解析：从容器 status 字符串或 inspect 状态中提取 exitCode (如 137, 127, 1, 139 等)；
 * 2. 经典退出码与 OOM 专家规则库：内置 Linux 信号学与容器生命周期知识库；
 * 3. 诊断 Prompt 智能装配：聚合容器基础元数据、内存配额、退出码与最近 30 行终端日志；
 * 4. 离线即时归因生成器：在离线或无 API Key 场景下一秒直出专业归因报告与调优命令。
 */

export interface DockerDiagnosisParams {
  serverId: string
  containerId: string
  containerName: string
  image: string
  status: string
  exitCode?: number | null
  oomKilled?: boolean
  memoryLimit?: number
  logsSnippet?: string
}

export interface ExitCodeHeuristic {
  code: number
  signalName: string
  title: string
  rootCause: string
  isOom: boolean
  suggestion: string
  recommendedCommands: string[]
}

/**
 * 从 Docker 容器 status 字符串提取退出码与判定是否异常退出
 * 例如: "Exited (137) 2 minutes ago" -> exitCode: 137, isAbnormal: true
 */
export function parseContainerExitCode(
  status: string,
  state?: string,
): { exitCode: number | null; isAbnormal: boolean } {
  if (!status && !state) {
    return { exitCode: null, isAbnormal: false }
  }

  const match = /Exited\s*\(([0-9]+)\)/i.exec(status || '')
  if (match) {
    const code = parseInt(match[1], 10)
    return {
      exitCode: code,
      isAbnormal: code !== 0,
    }
  }

  const s = (state || '').toLowerCase()
  if (s === 'dead') {
    return { exitCode: null, isAbnormal: true }
  }

  if (s === 'exited' && !status.includes('(0)')) {
    return { exitCode: null, isAbnormal: true }
  }

  return { exitCode: null, isAbnormal: false }
}

/**
 * 格式化字节内存大小为人类可读格式 (MB / GB)
 */
export function formatMemoryLimit(bytes?: number): string {
  if (!bytes || bytes <= 0 || bytes > 1024 * 1024 * 1024 * 1024 * 1024) {
    return '未设置上限 (使用宿主机全部内存)'
  }
  const GB = 1024 * 1024 * 1024
  const MB = 1024 * 1024

  if (bytes >= GB) {
    const val = bytes / GB
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}GB`
  }
  if (bytes >= MB) {
    const val = bytes / MB
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}MB`
  }
  return `${bytes} B`
}

/**
 * 获取退出码的专家规则与归因分析
 */
export function getExitCodeHeuristics(
  exitCode: number | null,
  oomKilled = false,
  memoryLimit?: number,
): ExitCodeHeuristic | null {
  if (exitCode === null) {
    if (oomKilled) {
      return {
        code: 137,
        signalName: 'SIGKILL (9)',
        title: 'Linux 内核 OOM Killer 强杀',
        rootCause: `容器内存消耗超出限制${memoryLimit ? ` (${formatMemoryLimit(memoryLimit)})` : ''}，触发系统 OOM Killer 强制发送 SIGKILL 终止进程`,
        isOom: true,
        suggestion: '调大容器的内存配额 (limits.memory)，或排查容器内部进程是否存在内存泄漏、JVM 堆配置过高等问题。',
        recommendedCommands: [
          'dmesg -T | grep -E -i "oom|killed process" | tail -n 20',
          'docker inspect {{CONTAINER_ID}} --format \'{{.State.OOMKilled}}\'',
          `docker update -m 1G {{CONTAINER_ID}}`,
        ],
      }
    }
    return null
  }

  switch (exitCode) {
    case 137:
      return {
        code: 137,
        signalName: 'SIGKILL (9)',
        title: '强制杀掉 (SIGKILL 137)',
        rootCause: oomKilled
          ? `容器超出设置的内存配额 (${formatMemoryLimit(memoryLimit)})，被 Linux 内核 OOM Killer 强制杀掉`
          : `容器超出内存配额被 Linux 内核 OOM Killer 强制杀掉，或者在执行 docker stop 时超过优雅停止宽限期 (默认 10s) 被系统强杀`,
        isOom: true,
        suggestion: '优先检查容器与宿主机内存使用情况，调大 limits.memory 配额，或排查应用内存泄漏。',
        recommendedCommands: [
          'dmesg -T | grep -E -i "oom|killed process" | tail -n 20',
          'docker inspect {{CONTAINER_ID}} --format \'OOMKilled: {{.State.OOMKilled}}, ExitCode: {{.State.ExitCode}}\'',
          `docker update -m 1G {{CONTAINER_ID}}`,
        ],
      }

    case 127:
      return {
        code: 127,
        signalName: 'Command Not Found',
        title: '命令或启动文件不存在 (127)',
        rootCause: '容器启动入口 (ENTRYPOINT / CMD) 指定的可执行文件或脚本在镜像内部不存在 (No such file or directory)。',
        isOom: false,
        suggestion: '检查 Dockerfile 中的 ENTRYPOINT/CMD 路径拼写是否正确，或注意 Alpine 等轻量镜像默认不带 bash (仅 /bin/sh) 且缺少 glibc。',
        recommendedCommands: [
          'docker inspect {{CONTAINER_ID}} --format \'Path: {{.Path}}, Args: {{.Args}}\'',
          'docker run --rm -it {{IMAGE}} sh',
        ],
      }

    case 126:
      return {
        code: 126,
        signalName: 'Permission Denied / Exec Format Error',
        title: '权限不足或架构不兼容 (126)',
        rootCause: '启动脚本缺少可执行权限 (+x)，或镜像的 CPU 架构与宿主机不兼容 (如在 ARM64 机器上运行纯 x86_64 二进制)。',
        isOom: false,
        suggestion: '给入口脚本增加执行权限 (chmod +x entrypoint.sh)，或在构建/拉取镜像时指定平台架构 (--platform linux/amd64)。',
        recommendedCommands: [
          'docker inspect {{CONTAINER_ID}} --format \'Platform: {{.Platform}}, Architecture: {{.Image}}\'',
        ],
      }

    case 1:
      return {
        code: 1,
        signalName: 'Application Error',
        title: '应用自身致命异常 (1)',
        rootCause: '应用程序抛出未捕获的严重运行时异常 (Runtime Exception)、配置文件解析失败或依赖的外部服务连通超时退出。',
        isOom: false,
        suggestion: '查看容器退出前的最后 30 行日志堆栈，定位首个报错 Traceback 或配置文件语法错误。',
        recommendedCommands: [
          'docker logs --tail 50 {{CONTAINER_ID}}',
        ],
      }

    case 139:
      return {
        code: 139,
        signalName: 'SIGSEGV (11)',
        title: '内存段错误 (SIGSEGV 139)',
        rootCause: '应用程序触发段错误 (Segmentation Fault / Core Dump)，通常由 C/C++ 底层依赖库非法访问内存指针或堆栈溢出引起。',
        isOom: false,
        suggestion: '检查容器内 Native 模块、第三方扩展库 (如 libssl, glibc) 的兼容性与核心转储文件。',
        recommendedCommands: [
          'docker logs --tail 50 {{CONTAINER_ID}}',
        ],
      }

    case 143:
      return {
        code: 143,
        signalName: 'SIGTERM (15)',
        title: '优雅终止信号 (SIGTERM 143)',
        rootCause: '容器接收到系统的正常终止信号并优雅停止退出 (通常是人为执行 docker stop 或编排系统缩容调度触发)。',
        isOom: false,
        suggestion: '此退出码一般代表正常停止，若属非预期停止，请检查宿主机重启记录或外部自动化重启脚本。',
        recommendedCommands: [
          'docker inspect {{CONTAINER_ID}} --format \'FinishedAt: {{.State.FinishedAt}}\'',
        ],
      }

    case 2:
      return {
        code: 2,
        signalName: 'Misuse of Shell Builtins',
        title: 'Shell 语法或参数错误 (2)',
        rootCause: '启动命令中包含不合法的 Shell 参数或内置关键字调用错误。',
        isOom: false,
        suggestion: '检查容器启动参数与环境变量传参，避免未转义的特殊字符。',
        recommendedCommands: [
          'docker inspect {{CONTAINER_ID}} --format \'Args: {{.Args}}\'',
        ],
      }

    default:
      return {
        code: exitCode,
        signalName: `Exit Code ${exitCode}`,
        title: `异常退出码 (${exitCode})`,
        rootCause: `容器异常退出，退出码为 ${exitCode}。`,
        isOom: false,
        suggestion: '结合容器最后 30 行日志与退出码定位具体异常原因。',
        recommendedCommands: [
          'docker logs --tail 50 {{CONTAINER_ID}}',
        ],
      }
  }
}

/**
 * 组装发送给 AI 小助手的结构化诊断 Prompt
 */
export function buildDockerDiagnosisPrompt(params: DockerDiagnosisParams): string {
  const exitCodeInfo = parseContainerExitCode(params.status)
  const code = params.exitCode ?? exitCodeInfo.exitCode
  const heuristic = getExitCodeHeuristics(code, params.oomKilled, params.memoryLimit)

  let prompt = `请帮我诊断 Docker 容器【${params.containerName}】的异常退出根因与处置方案：\n`
  prompt += `- 容器 ID: \`${params.containerId.slice(0, 12)}\`\n`
  prompt += `- 容器镜像: \`${params.image}\`\n`
  prompt += `- 当前状态: **${params.status}**`
  if (code !== null && code !== undefined) {
    prompt += ` (退出码: \`${code}\`)`
  }
  prompt += '\n'

  if (params.oomKilled) {
    prompt += `- 内核 OOM 标记: **OOMKilled: true (已被内核强杀)**\n`
  }
  if (params.memoryLimit && params.memoryLimit > 0) {
    prompt += `- 内存配额限制: **${formatMemoryLimit(params.memoryLimit)}**\n`
  }

  if (heuristic) {
    prompt += `- 退出码特征: **${heuristic.title}**（${heuristic.rootCause}）\n`
  }

  prompt += '\n【最后 30 行容器日志切片】：\n'
  if (params.logsSnippet && params.logsSnippet.trim()) {
    prompt += '```log\n' + params.logsSnippet.trim() + '\n```\n'
  } else {
    prompt += '*(未截取到标准输出日志，通常为启动瞬死或日志已清空)*\n'
  }

  prompt += '\n请在回答的正文第一行直接给出清晰明确的【退出根因归因结论】，并给出安全有效的修复调优建议与命令。'
  return prompt
}

/**
 * 在离线模式下（未配置 API Key）生成高水准的即时归因报告
 */
export function generateOfflineDockerDiagnosis(params: DockerDiagnosisParams): string {
  const exitCodeInfo = parseContainerExitCode(params.status)
  const code = params.exitCode ?? exitCodeInfo.exitCode
  const heuristic = getExitCodeHeuristics(code, params.oomKilled, params.memoryLimit)

  const shortId = params.containerId.slice(0, 12)
  const memStr = formatMemoryLimit(params.memoryLimit)

  if (code === 137 || params.oomKilled) {
    const memClause = params.memoryLimit && params.memoryLimit > 0
      ? `超出 **${memStr}** 内存限额`
      : '内存超限'
    return (
      `经现场即时归因诊断，容器 **【${params.containerName}】** 因${memClause}被 Linux 内核 **SIGKILL (137)** 强制杀掉，建议调大 limits.memory 配额。\n\n` +
      `### 🔍 根因溯源分析\n` +
      `- **异常退出码**：\`137\`（\`128 + 9\`，即操作系统内核向进程下发了不可被捕获的强制杀绝信号 \`SIGKILL\`）；\n` +
      `- **触发机制**：${params.oomKilled ? 'Docker 守护进程明确标记了 `OOMKilled: true`。' : '容器瞬间物理内存 (RSS) 飙升击穿了 Cgroup 配额。'}\n` +
      `- **配置现状**：当前容器内存上限为 \`${memStr}\`。\n\n` +
      `### 🛡️ 处置建议与调优指令\n` +
      `1. **查看内核 OOM 真实拦截记录**：\n` +
      `\`\`\`bash\n` +
      `dmesg -T | grep -E -i "oom|killed process" | tail -n 20\n` +
      `\`\`\`\n` +
      `2. **动态在线调大容器内存配额**（无需删除容器）：\n` +
      `\`\`\`bash\n` +
      `docker update -m 1G --memory-swap 2G ${params.containerName}\n` +
      `\`\`\`\n` +
      `3. **重新启动容器并持续观察**：\n` +
      `\`\`\`bash\n` +
      `docker start ${params.containerName}\n` +
      `\`\`\``
    )
  }

  if (code === 127) {
    return (
      `经现场即时归因诊断，容器 **【${params.containerName}】** 因启动命令未找到被系统以 **127 (Command Not Found)** 终止退出。\n\n` +
      `### 🔍 根因溯源分析\n` +
      `- **异常退出码**：\`127\`；\n` +
      `- **触发机制**：镜像内部找不到 ENTRYPOINT 或 CMD 指定的可执行文件或脚本路径（常见于路径写错、文件未拷贝或轻量镜像缺失运行环境）。\n\n` +
      `### 🛡️ 处置建议与调试指令\n` +
      `1. **临时以交互模式进入基础镜像排查**：\n` +
      `\`\`\`bash\n` +
      `docker run --rm -it ${params.image} sh\n` +
      `\`\`\`\n` +
      `2. **检查启动参数与文件路径**：\n` +
      `\`\`\`bash\n` +
      `docker inspect ${shortId} --format 'Entrypoint: {{.Path}}, Args: {{.Args}}'\n` +
      `\`\`\``
    )
  }

  if (code === 126) {
    return (
      `经现场即时归因诊断，容器 **【${params.containerName}】** 因启动文件缺少执行权限或架构不兼容被系统以 **126 (Permission Denied)** 终止退出。\n\n` +
      `### 🔍 根因溯源分析\n` +
      `- **异常退出码**：\`126\`；\n` +
      `- **触发机制**：目标启动脚本没有 \`+x\` 执行权限，或宿主机 CPU 架构（如 ARM vs x86）与镜像二进制架构不匹配。\n\n` +
      `### 🛡️ 处置建议\n` +
      `1. 检查构建镜像时的脚本权限：\`chmod +x /entrypoint.sh\`；\n` +
      `2. 若架构跨平台，运行/构建时显式指定：\`--platform linux/amd64\`。`
    )
  }

  if (code === 1) {
    return (
      `经现场即时归因诊断，容器 **【${params.containerName}】** 触发未捕获的严重运行时异常以 **Exit Code 1** 崩溃退出。\n\n` +
      `### 🔍 根因排查指引\n` +
      `结合退出前截获的日志，程序已抛出 Fatal Error 或配置文件解析异常。建议执行下方命令抓取完整异常堆栈：\n` +
      `\`\`\`bash\n` +
      `docker logs --tail 100 ${params.containerName}\n` +
      `\`\`\``
    )
  }

  // 通用兜底
  return (
    `经现场即时归因诊断，容器 **【${params.containerName}】** 状态为 **${params.status}**${code !== null ? `（退出码：\`${code}\`）` : ''}。\n\n` +
    `> 💡 **核心提示**：${heuristic?.rootCause || '容器发生非正常停机退出。'}\n` +
    `> 🛡️ **排查建议**：${heuristic?.suggestion || '请检查容器最后输出日志与系统状态。'}\n\n` +
    `建议运行只读命令查看详情：\n` +
    `\`\`\`bash\n` +
    `docker logs --tail 50 ${params.containerName}\n` +
    `\`\`\``
  )
}
