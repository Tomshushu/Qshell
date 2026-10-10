/**
 * 远程路径补全
 *
 * 通过 SSH 在远程主机执行 `ls -F -A <dir>` 获取目录条目，
 * 用于终端输入路径时的补全提示（如 `cd /usr/` → bin/ lib/ ...）。
 *
 * 设计要点：
 * - 节流：相同 (serverId, dirPath) 在 inflight 期间复用同一 Promise，避免重复请求
 * - 缓存：按 serverId 分桶，每条目带 TTL（默认 5s），过期自动失效
 * - 安全：远程命令使用单引号包裹路径，避免空格/特殊字符注入
 * - 解析：`ls -F` 在目录后追加 `/`，在可执行文件后追加 `*`，便于 UI 区分类型
 *
 * 与 completion-engine 解耦：引擎仅标记 expectingPath，
 * 由 terminal.tsx 在 path 阶段调用本模块异步拉取候选项。
 */

import { sshService } from '@/services/ssh-service'
import type { HintItem } from './types'

/** 缓存条目 */
interface CacheEntry {
  items: PathEntry[]
  ts: number
}

/** 解析后的路径条目 */
export interface PathEntry {
  /** 条目名（不含路径前缀），如 'bin' */
  name: string
  /** 补全时要插入的文本，目录带尾随 '/'，如 'bin/' */
  insertText: string
  /** 是否目录 */
  isDir: boolean
}

/** 缓存 TTL（毫秒） */
const CACHE_TTL_MS = 5_000

/** 每个服务器最大缓存目录条目数（LRU 限制） */
const MAX_CACHE_ENTRIES_PER_SERVER = 60

/** 按 serverId 分桶的缓存：serverId → dirPath → 条目（Map 保持插入顺序用作 LRU） */
const cache = new Map<string, Map<string, CacheEntry>>()

/** 进行中的请求：key=`${serverId}\0${dirPath}` → Promise */
const inflight = new Map<string, Promise<PathEntry[]>>()

/**
 * 把用户输入的路径片段拆分为「目录部分」+「前缀部分」。
 *
 * 例如：
 * - '/usr/l' → { dir: '/usr', prefix: 'l' }
 * - 'Do' → { dir: '.', prefix: 'Do' }（相对路径，对当前目录补全）
 * - '~/Do' → { dir: '~', prefix: 'Do' }
 * - '/' → { dir: '/', prefix: '' }
 * - '' → { dir: '.', prefix: '' }
 *
 * 容器/远程路径形态（如 docker cp 的 `web:/app/l`、scp 的 `host:/etc/l`）：
 * - 剥离 `prefix:` 部分（保留在 prefixTag 中供 joinPath 回填），
 *   对冒号后的路径部分做正常拆分。
 * - `web:`（冒号后为空）→ { dir: '.', prefix: '', prefixTag: 'web:' }
 */
export function splitPathInput(input: string): {
  dir: string
  prefix: string
  /** 容器/远程路径前缀（含冒号），如 'web:'；普通路径为 '' */
  prefixTag: string
} {
  if (!input) return { dir: '.', prefix: '', prefixTag: '' }
  // 单独 ~ 视为 home 目录（ls -F -A ~ 能正确展开）
  if (input === '~') return { dir: '~', prefix: '', prefixTag: '' }

  // 识别容器/远程路径前缀：name:path 形态
  // name 可含字母数字、-、_（容器名/主机名）；冒号后必须为空或路径形态
  let prefixTag = ''
  let pathPart = input
  const colonIdx = input.indexOf(':')
  if (colonIdx > 0) {
    const head = input.slice(0, colonIdx)
    const after = input.slice(colonIdx + 1)
    // head 必须是合法的容器/主机名（不含 / 空格 :）
    const isNameLike = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(head)
    // after 为空（web:）或路径形态（/ . ~ 开头或含 /）
    const afterIsPath =
      !after || after.startsWith('/') || after.startsWith('.') || after.startsWith('~') || after.includes('/')
    if (isNameLike && afterIsPath) {
      prefixTag = head + ':'
      pathPart = after
    }
  }

  // 含 /：取最后一个 / 之前为 dir，之后为 prefix
  const lastSlash = pathPart.lastIndexOf('/')
  if (lastSlash < 0) {
    // 无 /：相对当前目录补全（保留 prefixTag）
    return { dir: '.', prefix: pathPart, prefixTag }
  }
  const dir = pathPart.slice(0, lastSlash) || '/'
  const prefix = pathPart.slice(lastSlash + 1)
  return { dir: dir === '' ? '/' : dir, prefix, prefixTag }
}

/**
 * 远程执行 ls 获取目录条目（内部实现，不带节流）。
 *
 * 命令选择 `ls -F -A`：
 * - -F：目录追加 /，可执行追加 *，符号链接追加 @
 * - -A：列出除 . 和 .. 之外的所有条目（含隐藏文件）
 *
 * 路径使用单引号包裹；路径内的单引号用 '\'' 转义。
 */
async function fetchDirEntries(serverId: string, dir: string): Promise<PathEntry[]> {
  // ~ 开头时不能加单引号（否则 shell 不展开 ~）；其余路径加单引号防注入
  const safeDir = dir.replace(/'/g, `'\\''`)
  const pathArg = dir.startsWith('~') ? safeDir : `'${safeDir}'`
  // 使用 ls -F -A；若目录不存在或无权限，返回空数组
  const cmd = `ls -F -A ${pathArg} 2>/dev/null`
  const result = await sshService.execute(serverId, cmd)
  // exitCode 非 0 也可能是空目录或权限问题，统一按 stdout 解析
  const out = (result?.stdout ?? '').trim()
  if (!out) return []

  const entries: PathEntry[] = []
  for (const line of out.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // -F 追加的符号：/ * @ = |（目录/可执行/链接/套接字/管道）
    const isDir = trimmed.endsWith('/')
    // 去掉尾部类型符号得到真实名称
    const name = trimmed.replace(/[*@=|/]$/, '')
    if (!name) continue
    entries.push({
      name,
      insertText: isDir ? `${name}/` : name,
      isDir,
    })
  }
  // 目录优先，再按名称排序
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

/**
 * 获取目录条目（带节流 + 缓存）。
 *
 * - 命中缓存且未过期 → 直接返回
 * - 已有 inflight → 复用同一 Promise
 * - 否则发起请求，完成后写入缓存
 */
export function listRemoteDir(serverId: string, dir: string): Promise<PathEntry[]> {
  const key = `${serverId}\0${dir}`

  // 1. 命中缓存
  const bucket = cache.get(serverId)
  if (bucket) {
    const entry = bucket.get(dir)
    if (entry) {
      if (Date.now() - entry.ts < CACHE_TTL_MS) {
        // 刷新 LRU 位置（重新插入至末尾）
        bucket.delete(dir)
        bucket.set(dir, entry)
        return Promise.resolve(entry.items)
      } else {
        // 已过期主动移除，防止死条目堆积
        bucket.delete(dir)
      }
    }
  }

  // 2. 复用 inflight
  const existing = inflight.get(key)
  if (existing) return existing

  // 3. 发起新请求
  const p = fetchDirEntries(serverId, dir)
    .then((items) => {
      // 写入缓存并实施 LRU 容量控制
      let b = cache.get(serverId)
      if (!b) {
        b = new Map()
        cache.set(serverId, b)
      }
      if (b.has(dir)) {
        b.delete(dir)
      } else if (b.size >= MAX_CACHE_ENTRIES_PER_SERVER) {
        // 先清理超时的无用条目
        const now = Date.now()
        for (const [k, v] of b.entries()) {
          if (now - v.ts >= CACHE_TTL_MS) {
            b.delete(k)
          }
        }
        // 如果依然超出上限，淘汰最久未使用的头部条目
        while (b.size >= MAX_CACHE_ENTRIES_PER_SERVER) {
          const oldestKey = b.keys().next().value
          if (oldestKey !== undefined) {
            b.delete(oldestKey)
          } else {
            break
          }
        }
      }
      b.set(dir, { items, ts: Date.now() })
      return items
    })
    .catch((err) => {
      // 出错时不写缓存，返回空数组，避免污染后续请求
      console.warn('[remote-path-completion] fetch failed:', err)
      return [] as PathEntry[]
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, p)
  return p
}

/**
 * 拼接目录与条目，得到完整路径（作为 insertText）。
 *
 * - dir='.' → 直接返回条目（相对路径，不补 './'）
 * - dir 以 '/' 结尾 → dir + 条目（如 '/' + 'bin/' = '/bin/'）
 * - 否则 → dir + '/' + 条目（如 '/usr' + '/' + 'bin/' = '/usr/bin/'）
 *
 * 容器/远程路径前缀（prefixTag，如 'web:'）会被前置到结果：
 * - 'web:' + '/app/' + 'logs/' = 'web:/app/logs/'
 *
 * 完整路径作为 insertText，让 applyHint 的「替换最后一个 token」逻辑
 * 能正确计算追加后缀（完整路径以 lastToken 为前缀，substring 即得后缀）。
 */
function joinPath(dir: string, entryInsert: string, prefixTag = ''): string {
  let body: string
  if (dir === '.') body = entryInsert
  else if (dir.endsWith('/')) body = dir + entryInsert
  else body = dir + '/' + entryInsert
  // 容器/远程路径前缀回填
  // 注意：当 dir='.' 且 prefixTag 非空时（如输入 'web:'），body 是相对路径，
  // docker cp 等命令的容器路径相对容器根，无需补 '/'，直接拼接。
  return prefixTag + body
}

/**
 * 按前缀过滤目录条目，返回 HintItem[]（供 UI 直接渲染）。
 *
 * @param serverId 远程服务器 ID
 * @param input 用户当前输入的路径片段（如 '/usr/l' 或 'web:/app/l'，即命令行最后一个 token）
 * @param maxItems 最大返回条数
 */
export async function matchRemotePath(
  serverId: string,
  input: string,
  maxItems = 20,
): Promise<HintItem[]> {
  const { dir, prefix, prefixTag } = splitPathInput(input)
  const entries = await listRemoteDir(serverId, dir)

  const lower = prefix.toLowerCase()
  // 前缀匹配；返回的条目名均以 prefix 开头，保证 insertText（完整路径）
  // 以用户已输入的 lastToken 为前缀，applyHint 仅需追加后缀
  const filtered = prefix
    ? entries.filter((e) => e.name.toLowerCase().startsWith(lower))
    : entries

  return filtered.slice(0, maxItems).map((e) => ({
    kind: 'path' as const,
    // label 显示短名（不带 prefixTag，避免视觉冗余），insertText 用完整路径以便正确补全
    label: e.insertText,
    desc: e.isDir ? '目录' : '文件',
    insertText: joinPath(dir, e.insertText, prefixTag),
  }))
}

/**
 * 清空指定服务器的路径缓存。
 *
 * 场景：
 * - 用户切换服务器时调用，避免跨服务器串数据
 * - 服务器断开重连后调用，避免使用过期缓存
 */
export function clearRemotePathCache(serverId?: string): void {
  if (serverId) {
    cache.delete(serverId)
  } else {
    cache.clear()
  }
}
