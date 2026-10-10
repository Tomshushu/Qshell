/**
 * 动态补全 Provider 框架
 *
 * 设计目标：
 * - 在静态命令库之外，根据当前连接的服务器实时补全资源
 * - 例如 docker exec <Tab> → 容器名列表（来自 docker ps）
 * - 例如 systemctl restart <Tab> → 服务名列表（来自 systemctl list-unit-files）
 * - 例如 kubectl get pods 后 <Tab> → Pod 名列表
 * - 例如 git checkout <Tab> → 分支名列表
 *
 * 架构：
 * - 每个 Provider 注册一个「触发条件」（命令链 + 位置）
 * - 用户输入匹配触发条件时，引擎标记 dynamicProvider
 * - terminal.tsx 异步调用 provider.fetch() 获取候选项
 * - 结果带 TTL 缓存，避免重复请求
 *
 * 与静态补全的关系：
 * - 动态补全优先级高于静态 positional 提示
 * - 动态补全失败（网络错误/超时）时回退到静态提示
 * - 动态补全结果与路径补全互斥（路径补全由 expectingPath 触发）
 */

import { sshService } from '@/services/ssh-service'
import type { HintItem, DynamicSuggestion, DynamicCompletionProvider } from './types'

// 重新导出类型，便于现有 import 路径兼容
export type { DynamicSuggestion, DynamicCompletionProvider }

/** 缓存条目 */
interface CacheEntry {
  suggestions: DynamicSuggestion[]
  ts: number
}

/** 缓存 TTL（毫秒），动态资源变化较快，设为 10s */
const CACHE_TTL_MS = 10_000

/** 按 providerId+serverId 分桶的缓存 */
const cache = new Map<string, Map<string, CacheEntry>>()

/** inflight 请求去重：key = `${providerId}\0${serverId}`，与 remote-path-completion 保持一致。
 *  快速输入时（如 docker exec w → docker exec we）避免对同一 provider 重复发起 docker ps 等命令。 */
const inflight = new Map<string, Promise<DynamicSuggestion[]>>()

/** 读取缓存（未过期则返回） */
function getCache(providerId: string, serverId: string): DynamicSuggestion[] | null {
  const bucket = cache.get(providerId)
  if (!bucket) return null
  const entry = bucket.get(serverId)
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null
  return entry.suggestions
}

/** 写入缓存 */
function setCache(providerId: string, serverId: string, suggestions: DynamicSuggestion[]): void {
  let bucket = cache.get(providerId)
  if (!bucket) {
    bucket = new Map()
    cache.set(providerId, bucket)
  }
  bucket.set(serverId, { suggestions, ts: Date.now() })
}

/** 清空指定服务器的所有动态补全缓存 */
export function clearDynamicCache(serverId?: string): void {
  if (!serverId) {
    cache.clear()
    return
  }
  for (const bucket of cache.values()) {
    bucket.delete(serverId)
  }
}

/**
 * 在远程服务器执行命令并返回 stdout 行数组。
 *
 * 封装了错误处理：出错时返回空数组，不抛异常。
 */
async function execLines(serverId: string, cmd: string): Promise<string[]> {
  try {
    const result = await sshService.execute(serverId, cmd)
    const out = (result?.stdout ?? '').trim()
    if (!out) return []
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

/** 将 DynamicSuggestion 转换为 HintItem */
function toHintItems(suggestions: DynamicSuggestion[]): HintItem[] {
  return suggestions.map((s) => ({
    kind: 'dynamic' as const,
    label: s.insertText,
    desc: s.desc ?? '',
    insertText: s.insertText,
  }))
}

// ==================== 内置 Provider ====================

/**
 * Docker 容器名补全
 * 触发：docker exec / docker stop / docker start / docker rm / docker logs / docker restart / docker kill / docker pause / docker unpause / docker inspect / docker top / docker stats / docker wait / docker port / docker attach / docker commit / docker cp
 */
const dockerContainerProvider: DynamicCompletionProvider = {
  id: 'docker-containers',
  match(chain, _tokens, currentToken) {
    const dockerSubcmds = new Set([
      'exec', 'stop', 'start', 'restart', 'kill', 'rm',
      'logs', 'pause', 'unpause', 'inspect', 'top', 'stats',
      'wait', 'port', 'attach', 'commit', 'cp', 'rename',
    ])
    if (chain.length < 2) return false
    if (chain[0] !== 'docker') return false
    // docker exec 需要容器名作为第一个位置参数
    if (dockerSubcmds.has(chain[1]) && !currentToken.startsWith('-')) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    // 只列出运行中的容器（-a 会包含停止的，exec 只能操作运行中的）
    const lines = await execLines(
      serverId,
      'docker ps --format "{{.Names}}" 2>/dev/null',
    )
    return lines.map((name) => ({
      insertText: name,
      desc: '容器',
    }))
  },
}

/**
 * Docker 镜像名补全
 * 触发：docker run / docker rmi / docker history / docker inspect（镜像）/ docker save / docker tag / docker push
 */
const dockerImageProvider: DynamicCompletionProvider = {
  id: 'docker-images',
  match(chain, _tokens, currentToken) {
    const imageSubcmds = new Set(['run', 'rmi', 'history', 'save', 'tag', 'push'])
    if (chain.length < 2) return false
    if (chain[0] !== 'docker') return false
    if (imageSubcmds.has(chain[1]) && !currentToken.startsWith('-')) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    const lines = await execLines(
      serverId,
      'docker images --format "{{.Repository}}:{{.Tag}}" 2>/dev/null | grep -v "<none>"',
    )
    return lines.map((name) => ({
      insertText: name,
      desc: '镜像',
    }))
  },
}

/**
 * Systemd 服务名补全
 * 触发：systemctl start/stop/restart/reload/status/enable/disable/mask/unmask/is-active/is-enabled/show/edit
 */
const systemdProvider: DynamicCompletionProvider = {
  id: 'systemd-units',
  match(chain, _tokens, currentToken) {
    const systemdSubcmds = new Set([
      'start', 'stop', 'restart', 'reload', 'status',
      'enable', 'disable', 'mask', 'unmask',
      'is-active', 'is-enabled', 'show', 'edit',
    ])
    if (chain.length < 2) return false
    if (chain[0] !== 'systemctl') return false
    if (systemdSubcmds.has(chain[1]) && !currentToken.startsWith('-')) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    // 列出所有 service 单元（含状态）
    const lines = await execLines(
      serverId,
      'systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk \'{print $1}\'',
    )
    return lines.map((name) => ({
      insertText: name,
      desc: '服务',
    }))
  },
}

/**
 * Git 分支名补全
 * 触发：git checkout / git switch / git merge / git rebase / git cherry-pick / git reset / git log
 */
const gitBranchProvider: DynamicCompletionProvider = {
  id: 'git-branches',
  match(chain, _tokens, currentToken) {
    const gitBranchCmds = new Set([
      'checkout', 'switch', 'merge', 'rebase',
      'cherry-pick', 'reset', 'log', 'diff', 'branch',
    ])
    if (chain.length < 2) return false
    if (chain[0] !== 'git') return false
    if (gitBranchCmds.has(chain[1]) && !currentToken.startsWith('-')) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    // 列出本地分支（当前分支带 *）；同时附带 tag，因为 checkout/switch
    // 同样接受 tag 作为目标（满足「git checkout 除了 branch 还补 v1.0」）
    const [branchLines, tagLines] = await Promise.all([
      execLines(serverId, 'git branch --format="%(refname:short)" 2>/dev/null'),
      execLines(serverId, 'git tag --list 2>/dev/null'),
    ])
    const branches = branchLines.map((name) => ({ insertText: name, desc: '分支' }))
    const tags = tagLines.map((name) => ({ insertText: name, desc: '标签' }))
    return [...branches, ...tags]
  },
}

/**
 * 计算命令链之后「已完成」的位置参数个数（不含当前正在输入的 token）。
 *
 * 用于区分第一/第二位置参数：例如 git push <remote> <branch>，
 * 当已完成位置参数为 0 时补 remote，为 1 时补 branch。
 *
 * 注意：此为简化判定，不解析带值选项的值；对常见场景足够。
 */
function countCompletedPositionals(tokens: string[], chainLength: number): number {
  let count = 0
  for (let i = chainLength; i < tokens.length - 1; i++) {
    const t = tokens[i]
    if (t && !t.startsWith('-')) count++
  }
  return count
}

/**
 * Git Remote 名补全
 * 触发：git push / git pull / git fetch（第一个位置参数为 remote）
 */
const gitRemoteProvider: DynamicCompletionProvider = {
  id: 'git-remotes',
  match(chain, tokens, currentToken) {
    const gitRemoteCmds = new Set(['push', 'pull', 'fetch'])
    if (chain.length < 2) return false
    if (chain[0] !== 'git') return false
    if (!gitRemoteCmds.has(chain[1])) return false
    if (currentToken.startsWith('-')) return false
    // 仅在第一个位置参数阶段触发（push <remote>），避免 push origin <branch> 时仍弹 remote
    return countCompletedPositionals(tokens, chain.length) === 0
  },
  async fetch(serverId) {
    const lines = await execLines(serverId, 'git remote 2>/dev/null')
    return lines.map((name) => ({ insertText: name, desc: '远程仓库' }))
  },
}

/**
 * Git Tag 名补全
 * 触发：git tag（列出/删除标签）、git push <remote> <refspec>（第二位置参数可填 tag）
 */
const gitTagProvider: DynamicCompletionProvider = {
  id: 'git-tags',
  match(chain, tokens, currentToken) {
    if (chain.length < 2) return false
    if (chain[0] !== 'git') return false
    if (currentToken.startsWith('-')) return false
    // git tag <Tab> → 已有标签（用于 git tag -d / git tag -l）
    if (chain[1] === 'tag') return true
    // git push <remote> <refspec>：第二位置参数阶段补 tag/branch
    if (chain[1] === 'push' && countCompletedPositionals(tokens, chain.length) === 1) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    const lines = await execLines(serverId, 'git tag --list 2>/dev/null')
    return lines.map((name) => ({ insertText: name, desc: '标签' }))
  },
}

/**
 * SSH Host 补全（来自 ~/.ssh/config 的 Host 条目）
 * 触发：ssh / scp / sftp / rsync
 */
const sshHostProvider: DynamicCompletionProvider = {
  id: 'ssh-hosts',
  match(chain, _tokens, currentToken) {
    if (chain.length < 1) return false
    if (!['ssh', 'scp', 'sftp', 'rsync'].includes(chain[0])) return false
    // 仅在第一个位置参数阶段触发（ssh <host>），避免 ssh user@host ls 仍弹 host
    if (currentToken.startsWith('-')) return false
    // ssh 的第一位置参数形如 user@host，允许触发
    return true
  },
  async fetch(serverId) {
    const lines = await execLines(
      serverId,
      'awk \'tolower($1)=="host" && $2!="*" {for(i=2;i<=NF;i++) print $i}\' ~/.ssh/config 2>/dev/null',
    )
    return lines.map((name) => ({ insertText: name, desc: 'SSH 主机' }))
  },
}

/**
 * 用户名补全（来自 /etc/passwd）
 * 触发：su / passwd / usermod / userdel / useradd -u / groupmems
 */
const usernameProvider: DynamicCompletionProvider = {
  id: 'users',
  match(chain, tokens, currentToken) {
    if (chain.length < 1) return false
    if (!['su', 'passwd', 'usermod', 'userdel', 'chage', 'chsh'].includes(chain[0])) return false
    if (currentToken.startsWith('-')) return false
    // su / passwd 的第一位置参数为用户名
    return countCompletedPositionals(tokens, chain.length) === 0
  },
  async fetch(serverId) {
    const lines = await execLines(
      serverId,
      'getent passwd 2>/dev/null | cut -d: -f1 || cut -d: -f1 /etc/passwd 2>/dev/null',
    )
    return lines.map((name) => ({ insertText: name, desc: '用户' }))
  },
}

/**
 * 进程 PID 补全（来自 ps）
 * 触发：kill / killall / renice / pkill
 */
const processProvider: DynamicCompletionProvider = {
  id: 'processes',
  match(chain, tokens, currentToken) {
    if (chain.length < 1) return false
    if (!['kill', 'killall', 'renice'].includes(chain[0])) return false
    if (currentToken.startsWith('-')) return false
    // kill 的第一位置参数为 PID；renice 的优先级在前、PID 在后，这里宽松触发第一位置
    return countCompletedPositionals(tokens, chain.length) === 0
  },
  async fetch(serverId) {
    // 输出形如 "1234 nginx"，insertText 取 PID，desc 取进程名
    const lines = await execLines(
      serverId,
      'ps -eo pid=,comm= 2>/dev/null | head -100',
    )
    const result: DynamicSuggestion[] = []
    for (const line of lines) {
      const m = line.match(/^(\d+)\s+(.+)$/)
      if (m) result.push({ insertText: m[1], desc: m[2] })
    }
    return result
  },
}

/**
 * Journalctl 服务名补全
 * 触发：journalctl -u <service>
 */
const journalctlProvider: DynamicCompletionProvider = {
  id: 'journalctl-units',
  match(chain, tokens, currentToken) {
    if (chain.length < 1) return false
    if (chain[0] !== 'journalctl') return false
    if (currentToken.startsWith('-')) return false
    // 前一个 token 是 -u / --unit / --unit= 时为服务名值位置
    const prev = tokens[tokens.length - 2]
    if (prev === '-u' || prev === '--unit') return true
    return false
  },
  async fetch(serverId) {
    const lines = await execLines(
      serverId,
      'systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk \'{print $1}\'',
    )
    return lines.map((name) => ({ insertText: name, desc: '服务' }))
  },
}

/**
 * 网络主机名补全（来自 ~/.ssh/known_hosts 与 /etc/hosts）
 * 触发：ping / telnet / curl / wget / traceroute / nc
 */
const networkHostProvider: DynamicCompletionProvider = {
  id: 'network-hosts',
  match(chain, _tokens, currentToken) {
    if (chain.length < 1) return false
    if (!['ping', 'telnet', 'curl', 'wget', 'traceroute', 'nc', 'nmap'].includes(chain[0])) return false
    if (currentToken.startsWith('-')) return false
    return true
  },
  async fetch(serverId) {
    const [known, hosts] = await Promise.all([
      execLines(
        serverId,
        'cat ~/.ssh/known_hosts 2>/dev/null | cut -d" " -f1 | cut -d, -f1',
      ),
      execLines(
        serverId,
        'grep -vE "^#|^$" /etc/hosts 2>/dev/null | awk \'NF>1 {for(i=2;i<=NF;i++) print $i}\'',
      ),
    ])
    // 合并去重
    const seen = new Set<string>()
    const out: DynamicSuggestion[] = []
    for (const h of [...known, ...hosts]) {
      if (!h || seen.has(h)) continue
      seen.add(h)
      out.push({ insertText: h, desc: '主机' })
    }
    return out
  },
}

/**
 * kubectl 资源名补全
 * 触发：kubectl get <resource> → 补全资源类型；kubectl get pods → 补全 Pod 名
 */
const kubectlProvider: DynamicCompletionProvider = {
  id: 'kubectl-resources',
  match(chain, tokens, currentToken) {
    if (chain.length < 2) return false
    if (chain[0] !== 'kubectl') return false
    if (chain[1] !== 'get') return false
    // kubectl get <Tab> → 资源类型
    // kubectl get pods <Tab> → Pod 名
    if (!currentToken.startsWith('-')) return true
    return false
  },
  async fetch(serverId, _chain, tokens, currentToken) {
    // 如果当前 token 是资源类型阶段（tokens 中 get 之后只有一个正在输入的词）
    const afterGet = tokens.slice(tokens.indexOf('get') + 1)
    const isResourceTypePhase = afterGet.length <= 1

    if (isResourceTypePhase) {
      // 返回常用资源类型
      const resourceTypes = [
        'pods', 'po', 'deployments', 'deploy', 'services', 'svc',
        'namespaces', 'ns', 'nodes', 'no', 'configmaps', 'cm',
        'secrets', 'ingresses', 'ing', 'persistentvolumes', 'pv',
        'persistentvolumeclaims', 'pvc', 'serviceaccounts', 'sa',
        'roles', 'clusterroles', 'statefulsets', 'sts', 'daemonsets', 'ds',
        'jobs', 'cronjobs', 'cj', 'replicasets', 'rs',
      ]
      return resourceTypes
        .filter((t) => t.startsWith(currentToken.toLowerCase()))
        .map((t) => ({ insertText: t, desc: '资源类型' }))
    }

    // 资源名阶段：根据已输入的资源类型获取对应资源
    const resourceType = afterGet[0]
    const typeMap: Record<string, string> = {
      po: 'pods', pods: 'pods',
      deploy: 'deployments', deployments: 'deployments',
      svc: 'services', services: 'services',
      ns: 'namespaces', namespaces: 'namespaces',
      no: 'nodes', nodes: 'nodes',
      cm: 'configmaps', configmaps: 'configmaps',
      sts: 'statefulsets', statefulsets: 'statefulsets',
      ds: 'daemonsets', daemonsets: 'daemonsets',
    }
    const actualType = typeMap[resourceType] || resourceType
    const lines = await execLines(
      serverId,
      `kubectl get ${actualType} -o name 2>/dev/null | sed 's|.*/||'`,
    )
    return lines.map((name) => ({
      insertText: name,
      desc: actualType,
    }))
  },
}

/**
 * Docker Compose 服务名补全
 * 触发：docker-compose up / docker-compose stop / docker-compose start / docker-compose restart / docker-compose logs
 */
const dockerComposeProvider: DynamicCompletionProvider = {
  id: 'docker-compose-services',
  match(chain, _tokens, currentToken) {
    const composeSubcmds = new Set(['up', 'stop', 'start', 'restart', 'logs', 'exec', 'run', 'scale', 'rm'])
    if (chain.length < 2) return false
    if (chain[0] !== 'docker-compose') return false
    if (composeSubcmds.has(chain[1]) && !currentToken.startsWith('-')) {
      return true
    }
    return false
  },
  async fetch(serverId) {
    const lines = await execLines(
      serverId,
      'docker-compose config --services 2>/dev/null',
    )
    return lines.map((name) => ({
      insertText: name,
      desc: '服务',
    }))
  },
}

/** 所有内置 Provider */
const providers: DynamicCompletionProvider[] = [
  dockerContainerProvider,
  dockerImageProvider,
  systemdProvider,
  gitBranchProvider,
  gitRemoteProvider,
  gitTagProvider,
  sshHostProvider,
  usernameProvider,
  processProvider,
  journalctlProvider,
  networkHostProvider,
  kubectlProvider,
  dockerComposeProvider,
]

/** Provider 注册表（允许外部扩展） */
const providerRegistry = new Map<string, DynamicCompletionProvider>(
  providers.map((p) => [p.id, p]),
)

/** 注册自定义 Provider */
export function registerProvider(provider: DynamicCompletionProvider): void {
  providerRegistry.set(provider.id, provider)
}

/**
 * 查找匹配的 Provider。
 *
 * @param commandChain 命令链（如 ['docker','exec']）
 * @param tokens 输入 tokens
 * @param currentToken 当前 token
 * @returns 匹配的 Provider 或 null
 */
export function findProvider(
  commandChain: string[],
  tokens: string[],
  currentToken: string,
): DynamicCompletionProvider | null {
  for (const provider of providerRegistry.values()) {
    if (provider.match(commandChain, tokens, currentToken)) {
      return provider
    }
  }
  return null
}

/**
 * 获取动态补全候选项（带缓存）。
 *
 * @param serverId 服务器 ID
 * @param provider Provider 实例
 * @param commandChain 命令链
 * @param tokens tokens
 * @param currentToken 当前 token
 * @returns HintItem[]
 */
export async function fetchDynamicHints(
  serverId: string,
  provider: DynamicCompletionProvider,
  commandChain: string[],
  tokens: string[],
  currentToken: string,
): Promise<HintItem[]> {
  // 1. 查缓存
  const cached = getCache(provider.id, serverId)
  if (cached) {
    // 缓存结果按当前 token 前缀过滤
    const lower = currentToken.toLowerCase()
    const filtered = lower
      ? cached.filter((s) => s.insertText.toLowerCase().startsWith(lower))
      : cached
    return toHintItems(filtered)
  }

  // 2. inflight 去重：相同 provider+serverId 的并发请求复用同一 Promise
  const inflightKey = `${provider.id}\0${serverId}`
  const existing = inflight.get(inflightKey)
  let suggestions: DynamicSuggestion[]
  if (existing) {
    suggestions = await existing
  } else {
    const p = provider.fetch(serverId, commandChain, tokens, currentToken)
      .finally(() => {
        inflight.delete(inflightKey)
      })
    inflight.set(inflightKey, p)
    suggestions = await p
  }

  // 3. 写缓存（即使为空也写，避免空结果重复请求）
  setCache(provider.id, serverId, suggestions)

  // 4. 按前缀过滤并转换
  const lower = currentToken.toLowerCase()
  const filtered = lower
    ? suggestions.filter((s) => s.insertText.toLowerCase().startsWith(lower))
    : suggestions
  return toHintItems(filtered)
}
