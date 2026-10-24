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

/** 目录列表结果 */
export interface DirListResult {
  /** 目录条目 */
  entries: PathEntry[]
  /**
   * 目录是否有效（远端 `cd` 是否成功）。
   * - true：目录存在（可能为空目录，此时 entries=[]）
   * - false：目录不存在 / 无权限 / 路径无效
   *
   * 用于区分「空目录」与「cwd 失效」，避免空目录被误判成 cwd 错误而回退 home。
   */
  ok: boolean
}

/** 缓存条目 */
interface CacheEntry extends DirListResult {
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
  /** 是否隐藏项（`.` 开头）——排序时沉底，普通用户极少用到 */
  hidden: boolean
}

/** 缓存 TTL（毫秒） */
const CACHE_TTL_MS = 5_000

/** 每个服务器最大缓存目录条目数（LRU 限制） */
const MAX_CACHE_ENTRIES_PER_SERVER = 60

/** 按 serverId 分桶的缓存：serverId → dirPath → 条目（Map 保持插入顺序用作 LRU） */
const cache = new Map<string, Map<string, CacheEntry>>()

/** 进行中的请求：key=`${serverId}\0${dirPath}` → Promise */
const inflight = new Map<string, Promise<DirListResult>>()

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
 * 把远端路径转成安全的 shell 参数：
 * - `~` / `~/x` → `"$HOME"` / `"$HOME/x"`（双引号内 `$HOME` 仍展开，且空格不会被拆词）
 * - 其他 → 单引号包裹，内部 `'` 用 `'\''` 转义
 *
 * 用 `$HOME` 而不是裸 `~`，是为了同时满足「展开 home」和「路径含空格」两个需求。
 */
function toShellPath(dir: string): string {
  if (dir === '~') return '"$HOME"'
  if (dir.startsWith('~/')) {
    // 双引号内需要转义 " \ $ ` 以保留字面量
    const rest = dir.slice(2).replace(/(["\\$`])/g, '\\$1')
    return `"$HOME/${rest}"`
  }
  return `'${dir.replace(/'/g, `'\\''`)}'`
}

/** 解析主命令输出：目录带尾随 '/'，其余为文件 */
function parsePlainEntries(out: string): PathEntry[] {
  const entries: PathEntry[] = []
  for (const line of out.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim()
    if (!trimmed) continue
    const isDir = trimmed.endsWith('/')
    const name = isDir ? trimmed.slice(0, -1) : trimmed
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      insertText: isDir ? `${name}/` : name,
      isDir,
      hidden: name.startsWith('.'),
    })
  }
  return entries
}

/** 解析 `ls -F -A -t` 输出（降级路径）：去掉尾部类型符号（/ * @ = |） */
function parseLsFEntries(out: string): PathEntry[] {
  const entries: PathEntry[] = []
  for (const line of out.split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim()
    if (!trimmed) continue
    const isDir = trimmed.endsWith('/')
    const name = trimmed.replace(/[*@=|/]$/, '')
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      insertText: isDir ? `${name}/` : name,
      isDir,
      hidden: name.startsWith('.'),
    })
  }
  return entries
}

/**
 * 排序：隐藏项（`.` 开头）沉底，组内**保持 `ls -t` 的时间倒序**。
 *
 * 用稳定排序（ES2019+ 保证）只做「隐藏 / 非隐藏」分区，不重排组内顺序，
 * 从而保留 shell 端 `ls -t` 已按 mtime 降序排好的结果（近期修改的在前）。
 */
function sortEntries(entries: PathEntry[]): PathEntry[] {
  entries.sort((a, b) => Number(a.hidden) - Number(b.hidden))
  return entries
}

/**
 * 远程执行 ls 获取目录条目（内部实现，不带节流）。
 *
 * 类型判定用 shell 的 `[ -d ]`（会跟随符号链接），而不是 `ls -F` 的尾部标记：
 * - `ls -F` 对「指向目录的符号链接」只加 `@`（不加 `/`），会被误判为文件，
 *   导致 `cd`（只补目录）时这类链接目录（venv / conda env / 软链）完全不出现；
 * - `-1At`：一行一个名字（含空格安全），`-t` 按 mtime 降序（最近修改的在前）。
 *
 * 失败时降级为单命令 `ls -F -A -t`：fish / csh 等不支持 `while ... read` 语法的 shell
 * 仍能拿到基本列表（代价是链接目录会被当成文件）。
 *
 * `container`：非空时在容器内执行（`docker exec <name> sh -c '...'`）。
 */
async function fetchDirEntries(
  serverId: string,
  dir: string,
  container?: string,
): Promise<DirListResult> {
  const pathArg = toShellPath(dir)
  const wrap = (inner: string) =>
    container
      ? `docker exec ${toShellPath(container)} sh -c ${toShellPath(inner)}`
      : inner

  // 主命令：`cd ... || exit 1` 让「目录无效」体现为 exitCode != 0，
  // 从而与「目录存在但为空」（exitCode 0、stdout 空）区分开。
  // `-t`：按 mtime 降序（最近修改的在前），补全更符合直觉。
  const mainCmd = wrap(
    `cd ${pathArg} 2>/dev/null || exit 1; ` +
      `ls -1At | while IFS= read -r f; do ` +
      `[ -d "$f" ] && printf '%s/\\n' "$f" || printf '%s\\n' "$f"; done 2>/dev/null`,
  )
  const r1 = await sshService.execute(serverId, mainCmd)
  if ((r1?.exitCode ?? 0) === 0) {
    const out = (r1?.stdout ?? '').trim()
    return { entries: sortEntries(parsePlainEntries(out)), ok: true }
  }

  // 降级：shell 语法不兼容（fish/csh）或目录无效 → 用单命令再确认一次
  const fallbackCmd = wrap(`ls -F -A -t ${pathArg} 2>/dev/null`)
  const r2 = await sshService.execute(serverId, fallbackCmd)
  const ok = (r2?.exitCode ?? 0) === 0
  const out2 = (r2?.stdout ?? '').trim()
  return { entries: sortEntries(parseLsFEntries(out2)), ok }
}

/**
 * 获取目录条目（带节流 + 缓存）。
 *
 * - 命中缓存且未过期 → 直接返回
 * - 已有 inflight → 复用同一 Promise
 * - 否则发起请求，完成后写入缓存
 */
export function listRemoteDir(
  serverId: string,
  dir: string,
  container?: string,
): Promise<DirListResult> {
  // 缓存/inflight key 带上容器名：同一路径在宿主机与不同容器内是不同目录
  const key = `${serverId}\0${container ?? ''}\0${dir}`

  // 1. 命中缓存
  const bucket = cache.get(serverId)
  if (bucket) {
    const entry = bucket.get(key)
    if (entry) {
      if (Date.now() - entry.ts < CACHE_TTL_MS) {
        // 刷新 LRU 位置（重新插入至末尾）
        bucket.delete(key)
        bucket.set(key, entry)
        return Promise.resolve({ entries: entry.entries, ok: entry.ok })
      } else {
        // 已过期主动移除，防止死条目堆积
        bucket.delete(key)
      }
    }
  }

  // 2. 复用 inflight
  const existing = inflight.get(key)
  if (existing) return existing

  // 3. 发起新请求
  const p = fetchDirEntries(serverId, dir, container)
    .then((result) => {
      // 写入缓存并实施 LRU 容量控制
      let b = cache.get(serverId)
      if (!b) {
        b = new Map()
        cache.set(serverId, b)
      }
      if (b.has(key)) {
        b.delete(key)
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
      b.set(key, { entries: result.entries, ok: result.ok, ts: Date.now() })
      return result
    })
    .catch((err) => {
      // 出错时不写缓存；ok=false 表示目录不可用（区别于空目录）
      console.warn('[remote-path-completion] fetch failed:', err)
      return { entries: [], ok: false } as DirListResult
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
 * 把相对目录按终端当前工作目录解析为绝对路径，供远端 `ls` 使用。
 *
 * 关键背景：`sshService.execute` 走的是**独立 exec 通道**，其 cwd 是登录目录（home），
 * 并非交互式 shell 的当前目录。因此相对路径补全必须显式拼上终端 cwd，
 * 否则会出现「已在 ~/vector 里，补全却列出 home 的内容」。
 *
 * - cwd 缺失 → 原样返回（降级为旧行为，由 exec 通道的 home 决定）
 * - 绝对路径 / `~` 开头 → 原样（不拼 cwd）
 * - `.` → cwd
 * - 其他相对路径 → cwd + '/' + dir
 */
export function resolveDirAgainstCwd(dir: string, cwd?: string): string {
  if (!cwd || !dir) return dir
  if (dir.startsWith('/') || dir.startsWith('~')) return dir
  if (dir === '.') return cwd
  return `${cwd.replace(/\/+$/, '')}/${dir}`
}

/** 路径补全的过滤模式：只补全目录 / 只补全文件 / 全部 */
export type PathFilterMode = 'all' | 'dir' | 'file'

/**
 * 按前缀过滤目录条目，返回 HintItem[]（供 UI 直接渲染）。
 *
 * @param serverId 远程服务器 ID
 * @param input 用户当前输入的路径片段（如 '/usr/l' 或 'web:/app/l'，即命令行最后一个 token）
 * @param maxItems 最大返回条数
 * @param cwd 终端当前工作目录（绝对路径）；用于把相对路径补全解析到正确目录。
 *            容器/远程路径（web:/app）不受影响。
 * @param filterMode 过滤模式：`cd` 只补目录、`cat`/`vi` 只补文件、其余全部（见 inferPathFilterMode）
 */
export async function matchRemotePath(
  serverId: string,
  input: string,
  maxItems = 20,
  cwd?: string,
  filterMode: PathFilterMode = 'all',
  containerMode = false,
): Promise<HintItem[]> {
  const { dir, prefix, prefixTag } = splitPathInput(input)
  // 容器路径（如 `docker cp web:/app/l`）：在容器内执行 ls，且不拼本地 cwd。
  // 仅在调用方确认是 docker 命令时启用（containerMode），避免把 `host:/path` 误当容器。
  const container =
    containerMode && prefixTag ? prefixTag.slice(0, -1) : undefined
  // 容器/远程路径（web:/app）相对容器根，不拼终端 cwd；
  // 普通路径按终端当前目录解析，供远端 ls 用绝对路径执行（缓存 key 也随之区分目录）
  const resolvedDir = prefixTag ? dir : resolveDirAgainstCwd(dir, cwd)
  const first = await listRemoteDir(serverId, resolvedDir, container)
  // ok=false（目录不存在/无权限，通常是跟踪到的 cwd 失准）→ 保持空列表、面板隐藏。
  // **不回退 home**：把「cwd 错」伪装成「你在 home」列出无关内容，比「不提示」更误导。
  // 用户可直接输入绝对路径补全（绝对路径不依赖 cwd，始终可用）。
  const entries = first.entries

  const lower = prefix.toLowerCase()
  // 前缀匹配；返回的条目名均以 prefix 开头，保证 insertText（完整路径）
  // 以用户已输入的 lastToken 为前缀，applyHint 仅需追加后缀
  let filtered = prefix
    ? entries.filter((e) => e.name.toLowerCase().startsWith(lower))
    : entries
  // 按命令语义过滤：cd 只留目录、cat/vi 只留文件，避免误导
  if (filterMode === 'dir') {
    filtered = filtered.filter((e) => e.isDir)
  } else if (filterMode === 'file') {
    filtered = filtered.filter((e) => !e.isDir)
  }

  return filtered.slice(0, maxItems).map((e) => ({
    kind: 'path' as const,
    // label 显示短名（不带 prefixTag，避免视觉冗余），insertText 用完整路径以便正确补全
    label: e.insertText,
    desc: e.isDir ? '目录' : '文件',
    // 插入文本仍基于用户输入的原始 dir（相对形态），保证 applyHint 追加后缀正确
    insertText: joinPath(dir, e.insertText, prefixTag),
  }))
}

/**
 * 同步读取已缓存的目录条目文件名集合（供项目特征嗅探与连招加权零开销复用）。
 */
export function getCachedDirEntryNames(serverId?: string, cwd?: string | null): Set<string> {
  if (!serverId) return new Set()
  const bucket = cache.get(serverId)
  if (!bucket) return new Set()
  const dirKey = `${serverId}\0\0${cwd || '.'}`
  const entry = bucket.get(dirKey)
  if (!entry || !entry.ok) return new Set()
  return new Set(entry.entries.map((e) => e.name))
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
