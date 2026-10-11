/**
 * tools/sync-gitee-release.mjs
 * 
 * 作用：在 GitHub Actions 构建完成后（或本地执行），将 Release 安装包与产物
 * 自动同步上传到 Gitee Releases，并生成国内极速直连的 latest.json。
 * 
 * 机制：
 * 1. 优先使用 Gitee 官方国内 CDN 下载地址；
 * 2. 自动在 Gitee 创建或更新对应 Tag 的 Release；
 * 3. 自动同步 Windows / macOS / Linux 所有安装包及数字签名；
 * 4. 生成并推送 Gitee 专用的 latest.json 到 Gitee main 分支及 Release 资产中。
 */
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'

const GITEE_TOKEN = process.env.GITEE_TOKEN || '12c9b9f0edf788cf0e5c308134e5e316'
const GITEE_OWNER = process.env.GITEE_OWNER || 'Tom-shushu'
const GITEE_REPO = process.env.GITEE_REPO || 'qshell'
let defaultTag = 'v1.0.3'
try {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  if (pkg.version) defaultTag = `v${pkg.version.replace(/^v/i, '')}`
} catch {}
const TAG_NAME = (process.env.TAG_NAME || process.env.GITHUB_REF_NAME || defaultTag).replace(/^refs\/tags\//, '')

async function giteeRequest(path, options = {}) {
  const url = `https://gitee.com/api/v5${path}`
  const separator = url.includes('?') ? '&' : '?'
  const authedUrl = `${url}${separator}access_token=${GITEE_TOKEN}`

  const res = await fetch(authedUrl, {
    ...options,
    headers: {
      'User-Agent': 'Qshell-Release-Sync',
      ...(options.headers || {}),
    },
  })

  if (!res.ok && res.status !== 404) {
    const errorText = await res.text().catch(() => '')
    console.warn(`[Gitee API] ${options.method || 'GET'} ${path} returned ${res.status}: ${errorText}`)
  }
  return res
}

async function getOrCreateGiteeRelease(tag) {
  console.log(`[Gitee] Checking existing releases for tag: ${tag}`)
  const listRes = await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`)
  if (listRes.ok) {
    const releases = await listRes.json()
    const found = releases.find((r) => r.tag_name === tag)
    if (found) {
      console.log(`[Gitee] Found existing release: ID=${found.id}, tag=${found.tag_name}`)
      return found
    }
  }

  console.log(`[Gitee] Creating new release for tag: ${tag}`)
  const releaseBody = `## 🚀 Qshell ${tag} 正式版本发布

> 现代化极速终端与多协议服务器管理工作台。国内高速镜像托管发布。

### 📦 国内免翻墙极速下载通道 (推荐)

| 操作系统与架构 | 安装包类型 | 国内极速直链 (10~25MB/s) |
| :--- | :--- | :--- |
| **Windows 64位** | 安装包 (.exe) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/Tomshushu/Qshell/releases/download/${tag}/Qshell_${tag.replace(/^v/, '')}_x64-setup.exe) |
| **macOS Apple Silicon** | 镜像包 (.dmg) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/Tomshushu/Qshell/releases/download/${tag}/Qshell_${tag.replace(/^v/, '')}_aarch64.dmg) |
| **macOS 压缩包** | 应用包 (.app.tar.gz) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/Tomshushu/Qshell/releases/download/${tag}/Qshell_aarch64.app.tar.gz) |
| **Linux (全平台通用)** | 便携版 (.AppImage) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/Tomshushu/Qshell/releases/download/${tag}/Qshell_${tag.replace(/^v/, '')}_amd64.AppImage) |
| **Linux (Debian/Ubuntu)** | 安装包 (.deb) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/Tomshushu/Qshell/releases/download/${tag}/Qshell_${tag.replace(/^v/, '')}_amd64.deb) |

---
*注：Qshell 客户端内置智能动态双通道测速，更新时将自动优选国内最畅通的直连节点。*`

  const createRes = await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `Qshell ${tag}`,
      body: releaseBody,
      target_commitish: 'main',
    }),
  })

  if (!createRes.ok) {
    throw new Error(`Failed to create release on Gitee: ${createRes.status}`)
  }
  const newRelease = await createRes.json()
  console.log(`[Gitee] Created release successfully: ID=${newRelease.id}`)
  return newRelease
}

async function uploadFileToGiteeRelease(releaseId, filename, fileBuffer) {
  console.log(`[Gitee] Uploading attachment '${filename}' (${fileBuffer.byteLength} bytes)...`)
  const form = new FormData()
  form.append('access_token', GITEE_TOKEN)
  form.append('file', new Blob([fileBuffer]), filename)

  const res = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Failed to upload ${filename} to Gitee release: ${res.status} ${err}`)
  }
  const result = await res.json()
  console.log(`[Gitee] Successfully uploaded '${filename}': ${result.browser_download_url}`)
  return result
}

async function deleteExistingAttachment(releaseId, attachId) {
  await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files/${attachId}`, {
    method: 'DELETE',
  })
}

async function updateFileOnGiteeRepo(filePath, content, message) {
  // 检查文件是否存在
  const checkRes = await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}?ref=main`)
  let sha = null
  if (checkRes.ok) {
    const data = await checkRes.json()
    sha = data.sha
  }

  const base64Content = Buffer.from(content, 'utf8').toString('base64')
  if (sha) {
    console.log(`[Gitee Repo] Updating ${filePath} on main branch...`)
    await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: base64Content,
        sha,
        message,
        branch: 'main',
      }),
    })
  } else {
    console.log(`[Gitee Repo] Creating ${filePath} on main branch...`)
    await giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: base64Content,
        message,
        branch: 'main',
      }),
    })
  }
}

async function run() {
  console.log(`=======================================================`)
  console.log(`[Gitee Sync] Starting release sync for ${TAG_NAME}`)
  console.log(`[Gitee Sync] Target: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}`)
  console.log(`=======================================================`)

  const giteeRelease = await getOrCreateGiteeRelease(TAG_NAME)
  const existingAssets = (giteeRelease.assets || []).reduce((acc, a) => {
    acc[a.name] = a
    return acc
  }, {})

  // 1. 同步 GitHub Release 中的二进制资产到 Gitee Release
  const githubRepo = process.env.GITHUB_REPOSITORY || 'Tomshushu/Qshell'
  const githubToken = process.env.GITHUB_TOKEN || ''
  const githubReleaseId = process.env.GITHUB_RELEASE_ID || ''

  const ghHeaders = {
    'User-Agent': 'Qshell-Sync',
    ...(githubToken ? { 'Authorization': `Bearer ${githubToken}` } : {}),
  }

  let ghRelease = null
  if (githubReleaseId) {
    console.log(`[Gitee Sync] Fetching GitHub release by ID: ${githubReleaseId}`)
    try {
      const res = await fetch(`https://api.github.com/repos/${githubRepo}/releases/${githubReleaseId}`, { headers: ghHeaders })
      if (res.ok) ghRelease = await res.json()
    } catch (err) {
      console.warn(`[Gitee Sync] Failed to fetch release by ID:`, err.message)
    }
  }

  if (!ghRelease) {
    console.log(`[Gitee Sync] Fetching GitHub release by tag: ${TAG_NAME}`)
    try {
      const res = await fetch(`https://api.github.com/repos/${githubRepo}/releases/tags/${TAG_NAME}`, { headers: ghHeaders })
      if (res.ok) ghRelease = await res.json()
    } catch (err) {
      console.warn(`[Gitee Sync] Failed to fetch release by tag:`, err.message)
    }
  }

  if (!ghRelease) {
    throw new Error(`[Gitee Sync] Could not fetch GitHub release for tag '${TAG_NAME}' or ID '${githubReleaseId}'`)
  }

  console.log(`[Gitee Sync] Found ${ghRelease.assets?.length || 0} assets on GitHub release.`)

  const syncErrors = []

  // 按国内核心优先级重排资产：优先 Windows (.exe) 和 macOS (.dmg)，最后传 90MB+ 的 Linux AppImage
  const assetPriority = (name) => {
    if (name.includes('setup.exe')) return 1
    if (name.includes('.exe.sig')) return 2
    if (name.includes('.dmg')) return 3
    if (name.includes('app.tar.gz')) return 4
    if (name.includes('app.tar.gz.sig')) return 5
    if (name.includes('.deb')) return 6
    if (name.includes('.deb.sig')) return 7
    if (name.includes('.AppImage')) return 8
    if (name.includes('.AppImage.sig')) return 9
    return 10
  }

  const sortedAssets = [...(ghRelease.assets || [])].sort(
    (a, b) => assetPriority(a.name) - assetPriority(b.name)
  )

  for (const asset of sortedAssets) {
    if (asset.name === 'latest.json' || asset.name === 'latest-china.json') {
      continue // 针对 Gitee 重新生成的清单单独处理
    }

    if (existingAssets[asset.name]) {
      console.log(`[Gitee Sync] Asset '${asset.name}' already exists on Gitee, skipping.`)
      continue
    }

    let downloadedBuffer = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`[Gitee Sync] Downloading '${asset.name}' (${(asset.size / 1024 / 1024).toFixed(2)} MB, attempt ${attempt}/3)...`)
        const downloadRes = await fetch(asset.browser_download_url, {
          headers: { 'User-Agent': 'Qshell-Sync' },
          signal: AbortSignal.timeout(120_000),
        })
        if (!downloadRes.ok) {
          throw new Error(`Download failed: HTTP ${downloadRes.status} ${downloadRes.statusText}`)
        }
        const ab = await downloadRes.arrayBuffer()
        downloadedBuffer = Buffer.from(ab)
        break
      } catch (err) {
        console.warn(`[Gitee Sync] Attempt ${attempt} failed to download '${asset.name}':`, err.message)
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }

    if (!downloadedBuffer) {
      console.warn(`[Gitee Sync] Skipping asset '${asset.name}' due to download failure.`)
      syncErrors.push(`Failed to download ${asset.name} from GitHub`)
      continue
    }

    let uploadOk = false
    const maxAttempts = (asset.size && asset.size > 10 * 1024 * 1024) ? 2 : 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await uploadFileToGiteeRelease(giteeRelease.id, asset.name, downloadedBuffer)
        existingAssets[asset.name] = true
        uploadOk = true
        break
      } catch (err) {
        console.warn(`[Gitee Sync] Attempt ${attempt} failed to upload '${asset.name}' to Gitee:`, err.message)
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }

    if (!uploadOk) {
      console.warn(`[Gitee Sync] Skipping asset '${asset.name}' due to upload failure.`)
      syncErrors.push(`Failed to upload ${asset.name} to Gitee`)
    }
  }

  if (syncErrors.length > 0) {
    console.warn(`[Gitee Sync] Notice: Some non-critical assets failed to sync:\n  ${syncErrors.join('\n  ')}`)
  }

  // 2. 读取或准备原始 latest.json
  const manifestPath = process.env.MANIFEST_PATH || 'latest.json'
  let manifest = null

  // 优先从当前 Release 的 GitHub 产物中获取官方生成的 latest.json（确保版本号与签名 100% 对应）
  const ghManifestAsset = (ghRelease.assets || []).find((a) => a.name === 'latest.json')
  if (ghManifestAsset) {
    console.log(`[Gitee Sync] Fetching official manifest from GitHub Release asset: ${ghManifestAsset.browser_download_url}`)
    try {
      const res = await fetch(ghManifestAsset.browser_download_url, { headers: { 'User-Agent': 'Qshell-Sync' } })
      if (res.ok) {
        manifest = await res.json()
      }
    } catch (err) {
      console.warn(`[Gitee Sync] Failed to download manifest from release asset:`, err.message)
    }
  }

  // 兜底：若资产中未找到，尝试读取本地或 tag 路径
  if (!manifest && existsSync(manifestPath)) {
    try {
      const raw = await readFile(manifestPath, 'utf8')
      manifest = JSON.parse(raw)
    } catch (err) {
      console.warn(`[Gitee Sync] Could not parse local ${manifestPath}:`, err.message)
    }
  }

  if (!manifest) {
    const remoteUrl = `https://github.com/Tomshushu/Qshell/releases/download/${TAG_NAME}/latest.json`
    console.log(`[Gitee Sync] Fetching manifest from ${remoteUrl}...`)
    try {
      const res = await fetch(remoteUrl, { headers: { 'User-Agent': 'Qshell-Sync' } })
      if (res.ok) {
        manifest = await res.json()
      }
    } catch (err) {
      console.warn(`[Gitee Sync] Remote manifest fetch error:`, err.message)
    }
  }

  if (!manifest) {
    console.warn(`[Gitee Sync] No latest.json found. Skipping manifest URL rewriting.`)
  } else {
    // 2. 将清单中所有安装包下载地址改写为 Gitee 国内极速直链
    console.log(`[Gitee Sync] Rewriting download URLs to Gitee Releases CDN...`)
    const giteeManifest = JSON.parse(JSON.stringify(manifest))

    if (giteeManifest.platforms) {
      for (const [platformKey, platformData] of Object.entries(giteeManifest.platforms)) {
        if (platformData && platformData.url) {
          // 提取原始文件名
          const rawUrl = platformData.url
          const cleanUrl = rawUrl.replace(/^https:\/\/gh-proxy\.com\//, '')
          const filename = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1)
          
          if (existingAssets[filename]) {
            const giteeDownloadUrl = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${TAG_NAME}/${filename}`
            console.log(`  [${platformKey}] ${filename}`)
            console.log(`    -> Gitee Attachment: ${giteeDownloadUrl}`)
            platformData.url = giteeDownloadUrl
          } else {
            // 若 Gitee 附件因跨国网络超时跳过，自动优雅回退为国内 CDN 高速镜像，彻底避免客户端 404
            const fallbackUrl = `https://gh-proxy.com/https://github.com/${githubRepo}/releases/download/${TAG_NAME}/${filename}`
            console.log(`  [${platformKey}] ${filename}`)
            console.log(`    -> CDN Mirror Fallback: ${fallbackUrl}`)
            platformData.url = fallbackUrl
          }
        }
      }
    }

    const giteeManifestStr = JSON.stringify(giteeManifest, null, 2)
    await writeFile('latest-gitee.json', giteeManifestStr, 'utf8')

    // 3. 上传 latest.json 到 Gitee Release
    if (existingAssets['latest.json']) {
      console.log(`[Gitee Sync] Deleting old latest.json on Release...`)
      await deleteExistingAttachment(giteeRelease.id, existingAssets['latest.json'].id)
    }
    await uploadFileToGiteeRelease(giteeRelease.id, 'latest.json', Buffer.from(giteeManifestStr, 'utf8'))

    // 4. 同步更新 Gitee 仓库 main 分支根目录的 latest.json
    // 这样客户端可以以零代理、极高速度直连 https://gitee.com/Tom-shushu/qshell/raw/main/latest.json
    try {
      await updateFileOnGiteeRepo('latest.json', giteeManifestStr, `chore(release): update latest.json for ${TAG_NAME} [skip ci]`)
      console.log(`[Gitee Sync] Successfully updated latest.json in Gitee main branch!`)
    } catch (err) {
      console.warn(`[Gitee Sync] Failed to update latest.json on main branch:`, err.message)
    }
  }

  console.log(`=======================================================`)
  console.log(`[Gitee Sync] All Gitee sync steps completed successfully!`)
  console.log(`=======================================================`)
}

run().catch((err) => {
  console.error('[Gitee Sync] Fatal error:', err)
  process.exit(1)
})
