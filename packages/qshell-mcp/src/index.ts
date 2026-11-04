#!/usr/bin/env node
/**
 * packages/qshell-mcp/src/index.ts
 *
 * Qshell MCP 标准 stdio 薄壳 (形态 ①)
 * 供 Claude Desktop, Cursor, Claude Code, VS Code 等外部客户端接入
 *
 * 核心安全与设计准则：
 * 1. 【零 SSH / 零凭据依赖】：不持有任何 SSH 私钥、跳板机配置或数据库，彻底杜绝凭据扩散 (RK1/RK20)；
 * 2. 【单向纯净 stdio】：stdout 严禁输出任何调试日志，仅输出合法的 JSON-RPC 2.0 协议帧；所有日志走 stderr；
 * 3. 【共享策略前置】：调用前走 @qshell/policy 进行本地防御校验，返回经出向 DLP 与 8KB 截断的结构化结果；
 * 4. 【本地轻量网关转发】：通过 HTTP 127.0.0.1 访问 Qshell 主进程端点。
 */

import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import {
  evaluateCommandForExecution,
  validateSftpReadPath,
  respond,
  respondError,
  PROBE_SERVER_SCHEMA,
  EXECUTE_READONLY_COMMAND_SCHEMA,
  SFTP_READ_FILE_SCHEMA,
} from '@qshell/policy'

// 解析命令行参数
const args = process.argv.slice(2)
let cliPort: number | null = null
let cliToken: string | null = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    cliPort = parseInt(args[i + 1], 10)
    i++
  } else if (args[i] === '--token' && args[i + 1]) {
    cliToken = args[i + 1]
    i++
  }
}

// 自动定位 Qshell 主进程配置文件获取端口与 Token
function resolveLocalConfig(): { port: number; token: string } {
  if (cliPort && cliToken) {
    return { port: cliPort, token: cliToken }
  }

  const envPort = process.env.QSHELL_MCP_PORT ? parseInt(process.env.QSHELL_MCP_PORT, 10) : null
  const envToken = process.env.QSHELL_MCP_TOKEN || null

  if (envPort && envToken) {
    return { port: envPort, token: envToken }
  }

  // 扫描标准应用数据目录
  const candidateDirs: string[] = []
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    candidateDirs.push(
      path.join(appData, 'qshell'),
      path.join(appData, 'com.qshell.app'),
      path.join(os.homedir(), '.config', 'qshell'),
    )
  } else if (process.platform === 'darwin') {
    candidateDirs.push(
      path.join(os.homedir(), 'Library', 'Application Support', 'qshell'),
      path.join(os.homedir(), '.config', 'qshell'),
    )
  } else {
    candidateDirs.push(path.join(os.homedir(), '.config', 'qshell'))
  }

  for (const dir of candidateDirs) {
    const cfgPath = path.join(dir, 'qshell_mcp_config.json')
    try {
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed.token) {
          return {
            port: cliPort || envPort || parsed.port || 45680,
            token: cliToken || envToken || parsed.token,
          }
        }
      }
    } catch {
      // 容错继续查找
    }
  }

  return {
    port: cliPort || envPort || 45680,
    token: cliToken || envToken || '',
  }
}

const config = resolveLocalConfig()

function logInfo(msg: string) {
  process.stderr.write(`[qshell-mcp] ${msg}\n`)
}

function sendJsonRpc(obj: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

// 通过 HTTP 转发至 Qshell 主进程
async function forwardToLocalServer(requestBody: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(requestBody)
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: config.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Authorization: `Bearer ${config.token}`,
        },
        timeout: 15000,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            resolve(parsed)
          } catch {
            resolve({
              jsonrpc: '2.0',
              id: requestBody.id,
              error: { code: -32603, message: `主进程响应解析失败: ${data.slice(0, 100)}` },
            })
          }
        })
      },
    )

    req.on('error', (err) => {
      resolve({
        jsonrpc: '2.0',
        id: requestBody.id,
        error: {
          code: -32002,
          message: `无法连接 Qshell 主进程 (127.0.0.1:${config.port})。请先启动 Qshell 桌面端并在设置中开启 MCP 本地端点。错误: ${err.message}`,
        },
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        jsonrpc: '2.0',
        id: requestBody.id,
        error: { code: -32000, message: '请求 Qshell 主进程超时 (15s)' },
      })
    })

    req.write(payload)
    req.end()
  })
}

// 调度处理单个 JSON-RPC 消息
async function handleJsonRpc(request: Record<string, unknown>) {
  const method = String(request.method || '')
  const id = request.id as string | number | undefined

  switch (method) {
    case 'initialize': {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'qshell-mcp',
            version: '1.0.20',
          },
        },
      })
      break
    }

    case 'notifications/initialized': {
      // 通知消息，无需响应
      break
    }

    case 'tools/list': {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            PROBE_SERVER_SCHEMA,
            EXECUTE_READONLY_COMMAND_SCHEMA,
            SFTP_READ_FILE_SCHEMA,
          ],
        },
      })
      break
    }

    case 'tools/call': {
      const params = (request.params as Record<string, unknown>) || {}
      const name = String(params.name || '')
      const toolArgs = (params.arguments as Record<string, unknown>) || {}

      // 1. 本地安全前置校验 (在子进程侧做第一次截断防御)
      if (name === 'execute_readonly_command') {
        const cmd = String(toolArgs.command || '').trim()
        const decision = evaluateCommandForExecution(cmd, { executionMode: 'auto_readonly' })
        if (!decision.allowed) {
          const errRes = respondError({
            reason: decision.verdict?.reason || 'destructive',
            segment: decision.verdict?.segment || cmd,
            hint: decision.suggestedSafeCommand || '只读排障请使用只读命令（如 systemctl status, journalctl, ss 等）',
            message: `[安全网关拦截] 指令「${cmd}」已被系统安全防护网拦截阻断。原因：${decision.blockedReason || decision.reason}`,
          }, {
            tool: 'execute_readonly_command',
            command: cmd,
          })
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            result: errRes,
          })
          return
        }
      } else if (name === 'sftp_read_file') {
        const remotePath = String(toolArgs.remotePath || toolArgs.path || '').trim()
        const validation = validateSftpReadPath(remotePath)
        if (!validation.valid) {
          const errRes = respondError({
            reason: 'io-blocked',
            segment: remotePath,
            hint: '请提供白名单内绝对 POSIX 路径，且严禁包含 .. 或敏感凭据',
            message: `[安全网关拦截] 文件路径安全检查未通过：${validation.reason}`,
          }, {
            tool: 'sftp_read_file',
            remotePath,
          })
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            result: errRes,
          })
          return
        }
      }

      // 2. 转发主进程执行
      const remoteRes = await forwardToLocalServer(request)
      sendJsonRpc(remoteRes)
      break
    }

    // 默认透传 resources/list, resources/read, prompts/list, prompts/get 至主进程
    case 'resources/list':
    case 'resources/read':
    case 'prompts/list':
    case 'prompts/get': {
      const forwarded = await forwardToLocalServer(request)
      sendJsonRpc(forwarded)
      break
    }

    default: {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      })
      break
    }
  }
}

// 主事件循环：标准输入输出行流处理
function main() {
  logInfo(`薄壳启动中 (目标端点 127.0.0.1:${config.port})`)

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  })

  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      const req = JSON.parse(trimmed)
      handleJsonRpc(req).catch((err) => {
        logInfo(`处理异常: ${err}`)
      })
    } catch (e) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${(e as Error).message}` },
      })
    }
  })

  rl.on('close', () => {
    logInfo('标准输入已关闭，薄壳正常退出')
    process.exit(0)
  })
}

main()
