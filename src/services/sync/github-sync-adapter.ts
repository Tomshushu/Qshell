/**
 * src/services/sync/github-sync-adapter.ts
 *
 * GitHub REST API v3 驱动适配器：
 * 为全球与海外开发者提供多端加密云同步能力：
 * 1. 验证用户 GitHub Personal Access Token (PAT) 并获取用户信息（头像、登录名）；
 * 2. 检查并全自动创建私有备份仓库（qshell-cloud-backup）；
 * 3. 采用 PUT Contents API 上传与拉取加密备份文件；
 * 4. 查询历史备份提交（Git Commit 快照）；
 * 5. 针对国内网络波动提供友好的故障引导与重试提示。
 */

export interface GitHubUser {
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

const DEFAULT_REPO_NAME = 'qshell-cloud-backup'
const DEFAULT_FILE_PATH = 'qshell-backup.enc'
const GITHUB_API_BASE = 'https://api.github.com'

const DEFAULT_TIMEOUT_MS = 12000

async function fetchGitHub(
  url: string,
  token: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token.trim()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Qshell-Desktop-Sync',
        ...(options.headers || {}),
      },
    })
    return res
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('GitHub 连接超时。若您在国内网络环境，建议切换为 Gitee 享受 15ms 极速直连。')
    }
    const msg = (err as Error)?.message || ''
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      throw new Error('无法连接到 GitHub API。请检查代理设置，或切换使用 Gitee 国内极速同步。')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 验证 GitHub Personal Access Token 并获取用户信息
 */
export async function verifyGitHubToken(token: string): Promise<{ success: boolean; user?: GitHubUser; error?: string }> {
  const trimmed = token.trim()
  if (!trimmed) {
    return { success: false, error: '请输入有效的 GitHub 访问令牌 (Token)' }
  }

  try {
    const res = await fetchGitHub(`${GITHUB_API_BASE}/user`, trimmed)
    if (res.status === 401) {
      return { success: false, error: 'GitHub 令牌无效或已过期，请重新生成' }
    }
    if (res.status === 403) {
      return { success: false, error: 'API 请求超限或令牌权限不足，请确认已勾选 repo 权限' }
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { success: false, error: `GitHub 接口响应异常 (${res.status}): ${errText}` }
    }

    const data = await res.json()
    return {
      success: true,
      user: {
        id: data.id,
        login: data.login,
        name: data.name || data.login,
        avatar_url: data.avatar_url || '',
        html_url: data.html_url || `https://github.com/${data.login}`,
      },
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '网络连接失败' }
  }
}

/**
 * 确保 GitHub 私有备份仓库存在（若不存在则自动创建并初始化私有仓库）
 */
export async function ensureBackupRepo(
  token: string,
  owner: string,
  repoName = DEFAULT_REPO_NAME,
): Promise<{ success: boolean; defaultBranch: string; error?: string }> {
  try {
    // 1. 检测仓库是否已存在
    const checkRes = await fetchGitHub(`${GITHUB_API_BASE}/repos/${owner}/${repoName}`, token)
    if (checkRes.ok) {
      const repoData = await checkRes.json()
      return { success: true, defaultBranch: repoData.default_branch || 'main' }
    }

    // 2. 若 404 则自动创建私有仓库
    if (checkRes.status === 404) {
      console.log(`[GitHub Sync] 正在为用户 @${owner} 自动创建私有备份仓库: ${repoName}...`)
      const createRes = await fetchGitHub(`${GITHUB_API_BASE}/user/repos`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: repoName,
          description: 'Qshell End-to-End Encrypted Cloud Backup (Private)',
          private: true,
          auto_init: true, // 生成默认分支与初始提交
        }),
      })

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}))
        const msg = errJson.message || `HTTP ${createRes.status}`
        return {
          success: false,
          defaultBranch: 'main',
          error: `创建 GitHub 私有备份仓库失败: ${msg}（请确保 Token 勾选了 repo 权限）`,
        }
      }

      const newRepo = await createRes.json()
      return { success: true, defaultBranch: newRepo.default_branch || 'main' }
    }

    return { success: false, defaultBranch: 'main', error: `查询 GitHub 仓库状态异常: HTTP ${checkRes.status}` }
  } catch (err: unknown) {
    return { success: false, defaultBranch: 'main', error: (err as Error)?.message || '网络连接异常' }
  }
}

/**
 * 上传/提交加密备份文件到 GitHub
 */
export async function uploadBackupFile(
  token: string,
  owner: string,
  encryptedContent: string,
  repoName = DEFAULT_REPO_NAME,
  filePath = DEFAULT_FILE_PATH,
): Promise<{ success: boolean; sha?: string; error?: string }> {
  try {
    // 1. 确保私有备份仓库已就绪
    const repoInfo = await ensureBackupRepo(token, owner, repoName)
    if (!repoInfo.success) {
      return { success: false, error: repoInfo.error }
    }
    const branch = repoInfo.defaultBranch

    // 2. 检测已有文件的 SHA（GitHub PUT 更新必须提供当前文件的 SHA）
    const fileRes = await fetchGitHub(
      `${GITHUB_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}?ref=${branch}`,
      token,
    )

    let fileSha: string | null = null
    if (fileRes.ok) {
      const existing = await fileRes.json()
      fileSha = existing.sha
    }

    // 3. UTF-8 转 Base64
    const base64Content = btoa(unescape(encodeURIComponent(encryptedContent)))
    const commitMsg = `sync: auto backup from Qshell at ${new Date().toISOString()} [skip ci]`

    const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}`
    const payload = {
      message: commitMsg,
      content: base64Content,
      branch,
      ...(fileSha ? { sha: fileSha } : {}),
    }

    const uploadRes = await fetchGitHub(url, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!uploadRes.ok) {
      const errJson = await uploadRes.json().catch(() => ({}))
      return { success: false, error: `写入 GitHub 备份文件失败 (${uploadRes.status}): ${errJson.message || '未知错误'}` }
    }

    const result = await uploadRes.json()
    return { success: true, sha: result.content?.sha }
  } catch (err: unknown) {
    return { success: false, error: (err as Error)?.message || '上传异常' }
  }
}

/**
 * 从 GitHub 拉取加密备份文件
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
    const refParam = commitSha ? `?ref=${encodeURIComponent(commitSha)}` : ''
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/contents/${filePath}${refParam}`

    const res = await fetchGitHub(url, token)
    if (res.status === 404) {
      return { success: false, error: '云端暂未发现备份文件，请先在当前或其他设备上执行一次备份' }
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
 * 查询历史备份快照列表（基于 Git Commit 提交记录）
 */
export async function getBackupHistory(
  token: string,
  owner: string,
  repoName = DEFAULT_REPO_NAME,
  filePath = DEFAULT_FILE_PATH,
  limit = 10,
): Promise<{ success: boolean; history?: BackupCommitInfo[]; error?: string }> {
  try {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/commits?path=${filePath}&per_page=${limit}`
    const res = await fetchGitHub(url, token)
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
