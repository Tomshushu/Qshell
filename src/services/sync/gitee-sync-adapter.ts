/**
 * src/services/sync/gitee-sync-adapter.ts
 *
 * Gitee OpenAPI v5 驱动适配器：
 * 负责与 Gitee 交互，包含：
 * 1. 验证用户私人令牌 (Personal Access Token) 并获取用户信息（头像、登录名）；
 * 2. 检查并全自动创建私有备份仓库（qshell-cloud-backup）；
 * 3. 上传与下载 E2EE 加密备份文件；
 * 4. 查询历史备份快照版本（基于 Git Commit 历史）。
 */

export interface GiteeUser {
  id: number
  login: string
  name: string
  avatar_url: string
  html_url: string
}

export interface BackupCommitInfo {
  sha: string
  message: string
  date: string
}

export interface GiteeSyncOptions {
  token: string
  repoName?: string
  filePath?: string
}

const DEFAULT_REPO_NAME = 'qshell-cloud-backup'
const DEFAULT_FILE_PATH = 'qshell-backup.enc'
const GITEE_API_BASE = 'https://gitee.com/api/v5'

// 请求超时限制，防止弱网时死锁
const DEFAULT_TIMEOUT_MS = 10000

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Qshell-Desktop-Sync',
        ...(options.headers || {}),
      },
    })
    return res
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Gitee 请求超时，请检查国内网络连接')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 验证 Gitee 私人令牌并获取用户信息
 */
export async function verifyGiteeToken(token: string): Promise<{ success: boolean; user?: GiteeUser; error?: string }> {
  const trimmed = token.trim()
  if (!trimmed) {
    return { success: false, error: '请输入有效的 Gitee 私人令牌' }
  }

  try {
    const res = await fetchWithTimeout(`${GITEE_API_BASE}/user?access_token=${encodeURIComponent(trimmed)}`)
    if (res.status === 401) {
      return { success: false, error: '令牌无效或已过期，请核对后重试' }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { success: false, error: `Gitee 接口返回错误 (${res.status}): ${errText}` }
    }

    const data = await res.json()
    return {
      success: true,
      user: {
        id: data.id,
        login: data.login,
        name: data.name || data.login,
        avatar_url: data.avatar_url || '',
        html_url: data.html_url || `https://gitee.com/${data.login}`,
      },
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '网络连接失败' }
  }
}

/**
 * 确保备份私有仓库存在（若不存在则自动创建为私有仓库）
 */
export async function ensureBackupRepo(
  token: string,
  owner: string,
  repoName = DEFAULT_REPO_NAME,
): Promise<{ success: boolean; defaultBranch: string; error?: string }> {
  // 1. 检查仓库是否存在
  try {
    const checkRes = await fetchWithTimeout(`${GITEE_API_BASE}/repos/${owner}/${repoName}?access_token=${encodeURIComponent(token)}`)
    if (checkRes.ok) {
      const repoData = await checkRes.json()
      return { success: true, defaultBranch: repoData.default_branch || 'master' }
    }

    // 2. 若不存在 (404)，自动创建私有仓库
    if (checkRes.status === 404) {
      console.log(`[Gitee Sync] 正在自动创建私有备份仓库: ${owner}/${repoName}...`)
      const createRes = await fetchWithTimeout(`${GITEE_API_BASE}/user/repos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: token,
          name: repoName,
          description: 'Qshell 端到端加密多端同步专用仓库 (请保持私有)',
          private: true,
          auto_init: true, // 自动生成默认分支
        }),
      })

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => '')
        return { success: false, defaultBranch: 'master', error: `创建私有备份仓库失败 (${createRes.status}): ${errText}` }
      }

      const newRepo = await createRes.json()
      return { success: true, defaultBranch: newRepo.default_branch || 'master' }
    }

    return { success: false, defaultBranch: 'master', error: `查询仓库状态异常: HTTP ${checkRes.status}` }
  } catch (err: unknown) {
    return { success: false, defaultBranch: 'master', error: (err as Error)?.message || '网络异常' }
  }
}

/**
 * 上传/提交加密备份文件到 Gitee
 */
export async function uploadBackupFile(
  token: string,
  owner: string,
  encryptedContent: string,
  repoName = DEFAULT_REPO_NAME,
  filePath = DEFAULT_FILE_PATH,
): Promise<{ success: boolean; sha?: string; error?: string }> {
  try {
    // 1. 确保仓库存在
    const repoInfo = await ensureBackupRepo(token, owner, repoName)
    if (!repoInfo.success) {
      return { success: false, error: repoInfo.error }
    }
    const branch = repoInfo.defaultBranch

    // 2. 检查现有文件以获取 sha
    const fileRes = await fetchWithTimeout(
      `${GITEE_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}&access_token=${encodeURIComponent(token)}`,
    )

    let fileSha: string | null = null
    if (fileRes.ok) {
      const existing = await fileRes.json()
      fileSha = existing.sha
    }

    // 3. UTF-8 转 Base64
    const base64Content = btoa(unescape(encodeURIComponent(encryptedContent)))
    const commitMsg = `sync: auto backup from Qshell at ${new Date().toLocaleString('zh-CN')} [skip ci]`

    const url = `${GITEE_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}`
    const payload = {
      access_token: token,
      content: base64Content,
      message: commitMsg,
      branch,
      ...(fileSha ? { sha: fileSha } : {}),
    }

    const uploadRes = await fetchWithTimeout(url, {
      method: fileSha ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '')
      return { success: false, error: `写入文件失败 (${uploadRes.status}): ${errText}` }
    }

    const result = await uploadRes.json()
    return { success: true, sha: result.content?.sha }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '上传失败' }
  }
}

/**
 * 从 Gitee 拉取加密备份文件
 * @param commitSha 可选，指定拉取特定历史 commit 版本的快照文件；缺省时拉取最新主分支
 */
export async function downloadBackupFile(
  token: string,
  owner: string,
  repoName = DEFAULT_REPO_NAME,
  filePath = DEFAULT_FILE_PATH,
  commitSha?: string,
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const refParam = commitSha ? `&ref=${encodeURIComponent(commitSha)}` : ''
    const url = `${GITEE_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}?access_token=${encodeURIComponent(token)}${refParam}`

    const res = await fetchWithTimeout(url)
    if (res.status === 404) {
      return { success: false, error: '云端暂未发现备份文件，请先在源设备上执行一次备份' }
    }
    if (!res.ok) {
      return { success: false, error: `拉取备份文件失败 (HTTP ${res.status})` }
    }

    const data = await res.json()
    if (!data.content) {
      return { success: false, error: '备份文件内容为空' }
    }

    // Base64 解码为 UTF-8
    const cleaned = data.content.replace(/\s+/g, '')
    const decoded = decodeURIComponent(escape(atob(cleaned)))
    return { success: true, content: decoded }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '拉取异常' }
  }
}

/**
 * 查询历史备份版本列表（基于 Git Commit 提交记录）
 */
export async function getBackupHistory(
  token: string,
  owner: string,
  repoName = DEFAULT_REPO_NAME,
  filePath = DEFAULT_FILE_PATH,
  limit = 10,
): Promise<{ success: boolean; history?: BackupCommitInfo[]; error?: string }> {
  try {
    const url = `${GITEE_API_BASE}/repos/${owner}/${repoName}/commits?path=${filePath}&page=1&per_page=${limit}&access_token=${encodeURIComponent(token)}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      return { success: false, error: `查询历史提交失败: ${res.status}` }
    }

    const commits = await res.json()
    if (!Array.isArray(commits)) {
      return { success: true, history: [] }
    }

    const list: BackupCommitInfo[] = commits.map((c) => ({
      sha: c.sha,
      message: c.commit?.message || '备份快照',
      date: c.commit?.author?.date || '',
    }))

    return { success: true, history: list }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '查询失败' }
  }
}
