/**
 * ==============================================================================
 * ⚠️ 核心发布流程保护文件 (FROZEN / PROTECTED RELEASE CODE)
 * 本地紧急备用同步工具，核心逻辑已固化定死，后续严禁修改！
 * ==============================================================================
 * 
 * tools/sync-gitee-local.mjs
 * 
 * 作用：专为国内网络环境打造的 Gitee Releases 本地一键极速同步器。
 * 核心原理：
 * 1. 从国内高速 CDN 镜像节点（gh-proxy / ghproxy.net）直连拉取 GitHub Release 产物；
 * 2. 借助本地国内宽带直连 Gitee API，规避跨洋入关 DPI 审查与大文件连接重置（fetch failed）；
 * 3. 自动比对已存在附件实现“断点续传 / 秒传”，避免重复上传；
 * 4. 自动生成并同步国内极速专用的 latest.json 清单。
 * 
 * 使用方式：
 *   npm run release:gitee
 *   或者：node tools/sync-gitee-local.mjs [v1.0.7]
 */

import process from 'node:process'
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import readline from 'node:readline'

const GITEE_TOKEN = process.env.GITEE_TOKEN || '12c9b9f0edf788cf0e5c308134e5e316'
const GITEE_OWNER = process.env.GITEE_OWNER || 'Tom-shushu'
const GITEE_REPO = process.env.GITEE_REPO || 'qshell'
const GITHUB_REPO = process.env.GITHUB_REPOSITORY || 'Tomshushu/Qshell'

// 国内多路加速镜像源
const CDN_PROXIES = [
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
]

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let tag = 'v1.0.7'
let cleanVer = '1.0.7'

function normalizeTag(input) {
  const t = String(input || '').trim()
  return t.startsWith('v') ? t : `v${t}`
}

/**
 * 动态解析目标版本 Tag（支持 CLI 参数、--tag 选项或交互式回车确认）
 */
async function resolveTargetTag() {
  // 1. 尝试从命令行参数解析（支持 npm run release:gitee v1.0.6 或 --tag=v1.0.6 等）
  const args = process.argv.slice(2).filter((a) => a !== '--')
  let tagArg = null

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--tag=') || a.startsWith('-t=')) {
      tagArg = a.split('=')[1]
      break
    }
    if ((a === '--tag' || a === '-t' || a === '-v' || a === '--version') && args[i + 1]) {
      tagArg = args[i + 1]
      break
    }
    if (!a.startsWith('-')) {
      tagArg = a
      break
    }
  }

  // 默认版本（从本地 package.json 读取）
  let defaultTag = 'v1.0.7'
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    if (pkg.version) defaultTag = `v${pkg.version.replace(/^v/i, '')}`
  } catch {}

  if (tagArg) {
    return normalizeTag(tagArg)
  }

  // 2. 如果在交互式终端中运行，允许用户自由输入或按回车使用默认版本
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise((resolve) => {
      rl.question(`\n🏷️ 请输入要同步到 Gitee 的版本 Tag [默认直接按回车: ${defaultTag}]: `, (answer) => {
        rl.close()
        const chosen = answer.trim() || defaultTag
        resolve(normalizeTag(chosen))
      })
    })
  }

  return normalizeTag(defaultTag)
}

/**
 * 封装带超时的通用 fetch
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Gitee 基础 API 请求
 */
async function giteeApi(path, options = {}) {
  const url = `https://gitee.com/api/v5${path}`
  const sep = url.includes('?') ? '&' : '?'
  const authedUrl = `${url}${sep}access_token=${GITEE_TOKEN}`

  return fetchWithTimeout(authedUrl, {
    ...options,
    headers: {
      'User-Agent': 'Qshell-Release-Sync-Tool',
      ...(options.headers || {}),
    },
  }, 45000)
}

/**
 * 获取或创建 Gitee Release
 */
async function getOrCreateGiteeRelease() {
  console.log(`\n🔍 正在检索 Gitee 发行版列表 (Tag: ${tag})...`)
  const listRes = await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`)
  if (listRes.ok) {
    const releases = await listRes.json()
    const found = releases.find((r) => r.tag_name === tag)
    if (found) {
      console.log(`✅ 找到已有 Gitee 发行版: ID=${found.id}, Title=${found.name}`)
      return found
    }
  }

  console.log(`✨ 未找到发行版，正在创建 Gitee Release ${tag}...`)
  const releaseBody = `## 🚀 Qshell ${tag} 正式版本发布

> 现代化极速终端与多协议服务器管理工作台。国内高速镜像托管发布。

### 📦 国内免翻墙极速下载通道 (推荐)

| 操作系统与架构 | 安装包类型 | 国内极速直链 (10~25MB/s) |
| :--- | :--- | :--- |
| **Windows 64位** | 安装包 (.exe) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/download/${tag}/Qshell_${cleanVer}_x64-setup.exe) |
| **macOS Apple Silicon** | 镜像包 (.dmg) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/download/${tag}/Qshell_${cleanVer}_aarch64.dmg) |
| **macOS 压缩包** | 应用包 (.app.tar.gz) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/download/${tag}/Qshell_aarch64.app.tar.gz) |
| **Linux (全平台通用)** | 便携版 (.AppImage) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/download/${tag}/Qshell_${cleanVer}_amd64.AppImage) |
| **Linux (Debian/Ubuntu)** | 安装包 (.deb) | [⚡ 点击极速下载](https://gh-proxy.com/https://github.com/${GITHUB_REPO}/releases/download/${tag}/Qshell_${cleanVer}_amd64.deb) |

---
*注：Qshell 客户端内置智能动态双通道测速，更新时将自动优选国内最畅通的直连节点。*`

  const createRes = await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`, {
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
    const errText = await createRes.text()
    throw new Error(`创建 Gitee Release 失败 (${createRes.status}): ${errText}`)
  }

  const created = await createRes.json()
  console.log(`🎉 成功创建 Gitee 发行版: ID=${created.id}`)
  return created
}

/**
 * 强力下载文件：优先调用系统 curl.exe（Windows 原生 SChannel 网络栈），支持低速保护与自动重试
 */
async function downloadAssetWithFallback(filename) {
  const directGithubUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${filename}`
  const targetUrls = [
    ...CDN_PROXIES.map((prefix) => `${prefix}${directGithubUrl}`),
    directGithubUrl,
  ]

  const tempPath = path.resolve(`.tmp_sync_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`)

  for (const url of targetUrls) {
    try {
      const startTime = Date.now()
      const curlProc = spawnSync('curl.exe', [
        '-L',
        '--silent',
        '--show-error',
        '--connect-timeout', '10',
        '--speed-limit', '5120', // 若连续 15s 低于 5KB/s 则自动断开换下一个源
        '--speed-time', '15',
        '--max-time', '180',
        '-H', `User-Agent: ${BROWSER_UA}`,
        '-H', 'Referer: https://gitee.com/',
        '-o', tempPath,
        url,
      ], { stdio: 'pipe' })

      if (curlProc.status === 0 && existsSync(tempPath)) {
        const buffer = readFileSync(tempPath)
        try { unlinkSync(tempPath) } catch {}
        if (buffer.length > 500) { // 规避极小的错误网页落地
          const duration = ((Date.now() - startTime) / 1000).toFixed(1)
          const speed = (buffer.length / 1024 / 1024 / Math.max(0.1, Number(duration))).toFixed(1)
          return { buffer, duration, speed }
        }
      }
    } catch {}
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath) } catch {}
    }
  }

  // 备用兜底：尝试轻量 fetch
  for (const url of targetUrls) {
    try {
      const startTime = Date.now()
      const res = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Referer': 'https://gitee.com/',
        },
        redirect: 'follow',
      }, 15000)

      if (res.ok) {
        const ab = await res.arrayBuffer()
        const buffer = Buffer.from(ab)
        if (buffer.length > 500) {
          const duration = ((Date.now() - startTime) / 1000).toFixed(1)
          const speed = (buffer.length / 1024 / 1024 / Math.max(0.1, Number(duration))).toFixed(1)
          return { buffer, duration, speed }
        }
      }
    } catch {}
  }

  throw new Error(`在 GitHub 发行版中未找到 '${filename}' 或所有镜像节点无法拉取`)
}

/**
 * 上传文件到 Gitee Release 附件（增强版：URL 鉴权 + 弹性重试 + curl.exe 双模兜底）
 */
async function uploadToGitee(releaseId, filename, buffer) {
  const uploadUrl = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files?access_token=${GITEE_TOKEN}`
  const startTime = Date.now()

  // 针对 90MB+ 超大文件，设置充裕超时（最少 120s，最多 600s）
  const timeoutMs = Math.min(600_000, Math.max(120_000, Math.ceil(buffer.length / 1024 / 15) * 1000))

  let lastError = null

  // 尝试 1：优先使用带 URL 鉴权的 Node.js fetch 直传
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const form = new FormData()
      form.append('access_token', GITEE_TOKEN)
      form.append('file', new Blob([buffer]), filename)

      const res = await fetchWithTimeout(uploadUrl, {
        method: 'POST',
        body: form,
      }, timeoutMs)

      if (res.ok) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        const speed = (buffer.length / 1024 / 1024 / Math.max(0.1, Number(duration))).toFixed(1)
        return { duration, speed }
      } else {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }
    } catch (err) {
      lastError = err
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500))
    }
  }

  // 尝试 2：如果 Node fetch 传输大体积被对端重置，自动回退到系统原生 curl.exe 流式表单直传
  const tempPath = path.resolve(`.tmp_up_${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  try {
    writeFileSync(tempPath, buffer)
    const curlProc = spawnSync('curl.exe', [
      '-X', 'POST',
      '--silent',
      '--show-error',
      '--max-time', '600',
      '-F', `access_token=${GITEE_TOKEN}`,
      '-F', `file=@${tempPath}`,
      uploadUrl,
    ], { stdio: 'pipe' })

    if (curlProc.status === 0) {
      const stdout = curlProc.stdout?.toString('utf8') || ''
      if (stdout.includes('"id"') || stdout.includes('"browser_download_url"')) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1)
        const speed = (buffer.length / 1024 / 1024 / Math.max(0.1, Number(duration))).toFixed(1)
        return { duration, speed }
      } else {
        throw new Error(`Gitee 返回异常: ${stdout.substring(0, 200)}`)
      }
    } else {
      const stderr = curlProc.stderr?.toString('utf8') || ''
      throw new Error(`curl 上传失败: ${stderr.substring(0, 200)}`)
    }
  } finally {
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath) } catch {}
    }
  }

  throw new Error(lastError?.message || '上传失败')
}

/**
 * 更新 Gitee 仓库主分支根目录文件
 */
async function updateGiteeRepoFile(filePath, content, message) {
  const checkRes = await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}?ref=main`)
  let sha = null
  if (checkRes.ok) {
    const data = await checkRes.json()
    sha = data.sha
  }

  const base64Content = Buffer.from(content, 'utf8').toString('base64')
  if (sha) {
    console.log(`📝 正在更新 Gitee main 分支上的 ${filePath}...`)
    await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`, {
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
    console.log(`📝 正在创建 Gitee main 分支上的 ${filePath}...`)
    await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`, {
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

async function getGiteeAttachFiles(releaseId) {
  const res = await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`)
  if (res.ok) {
    return await res.json()
  }
  return []
}

async function deleteGiteeAttachFile(releaseId, attachId) {
  await giteeApi(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files/${attachId}`, {
    method: 'DELETE',
  })
}

/**
 * 主执行流程
 */
async function main() {
  tag = await resolveTargetTag()
  cleanVer = tag.replace(/^v/, '')

  console.log(`===================================================================`)
  console.log(`🚀 [Qshell Gitee 本地极速同步器]`)
  console.log(`   目标版本 : ${tag} (${cleanVer})`)
  console.log(`   GitHub源 : https://github.com/${GITHUB_REPO}/releases/tag/${tag}`)
  console.log(`   Gitee目标: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases`)
  console.log(`===================================================================`)

  const giteeRelease = await getOrCreateGiteeRelease()
  
  // 权威获取 Gitee Release 的真实附件列表（带 ID，支持去重）
  const attachFiles = await getGiteeAttachFiles(giteeRelease.id)
  const existingMap = new Map()
  
  // 自动排查并清理历史同名重复附件
  for (const asset of attachFiles) {
    if (existingMap.has(asset.name)) {
      console.log(`🧹 发现历史同名重复附件: '${asset.name}' (ID: ${asset.id})，正在自动清理...`)
      await deleteGiteeAttachFile(giteeRelease.id, asset.id)
    } else {
      existingMap.set(asset.name, asset)
    }
  }

  console.log(`\n📋 正在从国内加速源拉取 ${tag} 的官方发布清单...`)
  let manifest = null
  try {
    const { buffer } = await downloadAssetWithFallback('latest.json')
    manifest = JSON.parse(buffer.toString('utf8'))
    console.log(`✅ 成功获取最新 OTA 清单，版本号: ${manifest.version}, 平台数: ${Object.keys(manifest.platforms || {}).length}`)
  } catch (err) {
    console.warn(`⚠️ 拉取 latest.json 提示:`, err.message)
  }

  // 汇聚待同步的完整资产清单
  const candidateAssets = new Set([
    `Qshell_${cleanVer}_x64-setup.exe`,
    `Qshell_${cleanVer}_x64-setup.exe.sig`,
    `Qshell_${cleanVer}_aarch64.dmg`,
    `Qshell_${cleanVer}_aarch64.app.tar.gz`,
    `Qshell_${cleanVer}_aarch64.app.tar.gz.sig`,
    `Qshell_aarch64.app.tar.gz`,
    `Qshell_aarch64.app.tar.gz.sig`,
    `Qshell_${cleanVer}_amd64.deb`,
    `Qshell_${cleanVer}_amd64.deb.sig`,
    `Qshell_${cleanVer}_amd64.AppImage`,
    `Qshell_${cleanVer}_amd64.AppImage.sig`,
  ])

  if (manifest && manifest.platforms) {
    for (const p of Object.values(manifest.platforms)) {
      if (p.url) {
        const fname = p.url.substring(p.url.lastIndexOf('/') + 1)
        candidateAssets.add(fname)
        candidateAssets.add(`${fname}.sig`)
      }
    }
  }

  // 排序优先级：签名文件优先，核心安装包随后，超大包最后
  const assetList = Array.from(candidateAssets).sort((a, b) => {
    const score = (name) => {
      if (name.endsWith('.sig')) return 1
      if (name.endsWith('.exe')) return 2
      if (name.endsWith('.dmg')) return 3
      if (name.endsWith('.deb')) return 4
      if (name.includes('app.tar.gz')) return 5
      if (name.endsWith('.AppImage')) return 6
      return 10
    }
    return score(a) - score(b)
  })

  console.log(`\n📦 待同步核心资产总数: ${assetList.length} 项`)
  let uploadedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (let i = 0; i < assetList.length; i++) {
    const filename = assetList[i]
    const seq = `[${i + 1}/${assetList.length}]`

    if (existingMap.has(filename)) {
      console.log(`${seq} ⏩ Gitee 已存在 '${filename}'，跳过 (秒传)`)
      skippedCount++
      continue
    }

    // 优先检测本地是否存在该文件（用户浏览器极速下载后存放的 ~/Downloads、当前目录或 dist 目录）
    const candidateLocalPaths = [
      path.join(process.env.USERPROFILE || '', 'Downloads', filename),
      path.resolve(filename),
      path.resolve('dist', filename),
      path.resolve('downloads', filename),
    ]

    let foundLocalPath = null
    for (const p of candidateLocalPaths) {
      if (existsSync(p)) {
        foundLocalPath = p
        break
      }
    }

    let fileBuffer = null
    let sizeMb = 0

    if (foundLocalPath) {
      console.log(`${seq} 📁 在本地文件系统发现 '${filename}' (${foundLocalPath})`)
      fileBuffer = readFileSync(foundLocalPath)
      sizeMb = (fileBuffer.length / 1024 / 1024).toFixed(2)
      console.log(`     📦 读取本地成功 (${sizeMb} MB)`)
    } else {
      process.stdout.write(`${seq} ⬇️ 正在从国内加速源拉取 '${filename}'... `)
      try {
        const fileData = await downloadAssetWithFallback(filename)
        fileBuffer = fileData.buffer
        sizeMb = (fileBuffer.length / 1024 / 1024).toFixed(2)
        process.stdout.write(`完成 (${sizeMb} MB, 耗时 ${fileData.duration}s, 速率 ${fileData.speed} MB/s)\n`)
      } catch (err) {
        process.stdout.write(`❌ 本地与镜像源未就绪 (提示: 可在浏览器点击极速链接下载到 Downloads，脚本将自动识别秒传)\n`)
        continue
      }
    }

    process.stdout.write(`     ⬆️ 正在通过国内宽带直连上传 '${filename}' 到 Gitee... `)
    try {
      const upResult = await uploadToGitee(giteeRelease.id, filename, fileBuffer)
      process.stdout.write(`✅ 成功! (耗时 ${upResult.duration}s, 上传速率 ${upResult.speed} MB/s)\n`)
      existingMap.set(filename, true)
      uploadedCount++
    } catch (err) {
      process.stdout.write(`❌ 上传失败: ${err.message}\n`)
      failedCount++
    }
  }

  // 同步 Gitee 专用的 latest.json
  if (manifest) {
    console.log(`\n🔄 正在生成 Gitee 专用的国内高速 latest.json...`)
    const giteeManifest = JSON.parse(JSON.stringify(manifest))
    for (const [platformKey, plat] of Object.entries(giteeManifest.platforms || {})) {
      if (plat.url) {
        const rawFname = plat.url.substring(plat.url.lastIndexOf('/') + 1)
        plat.url = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/${rawFname}`
      }
    }

    const manifestStr = JSON.stringify(giteeManifest, null, 2)

    try {
      // 检查并删除 Gitee 上所有旧的 latest.json 与 latest-china.json 附件，避免重复追加
      const currentAttaches = await getGiteeAttachFiles(giteeRelease.id)
      for (const a of currentAttaches) {
        if (a.name === 'latest.json' || a.name === 'latest-china.json') {
          console.log(`🧹 正在清理旧版清单附件: ${a.name} (ID: ${a.id})...`)
          await deleteGiteeAttachFile(giteeRelease.id, a.id)
        }
      }

      console.log(`📤 正在上传唯一的 Gitee latest.json 附件...`)
      await uploadToGitee(giteeRelease.id, 'latest.json', Buffer.from(manifestStr, 'utf8'))
      console.log(`✅ Gitee Release latest.json 挂载更新成功!`)
    } catch (err) {
      console.warn(`⚠️ latest.json 附件提醒:`, err.message)
    }

    try {
      await updateGiteeRepoFile('latest.json', manifestStr, `chore(release): update latest.json for ${tag} [skip ci]`)
      console.log(`✅ Gitee main 分支最新 latest.json 更新成功!`)
    } catch (err) {
      console.warn(`⚠️ Gitee main 分支更新提醒:`, err.message)
    }
  }

  console.log(`\n===================================================================`)
  console.log(`🏁 [Gitee 极速同步完成]`)
  console.log(`   新上传: ${uploadedCount} 项`)
  console.log(`   已存在: ${skippedCount} 项`)
  console.log(`   Gitee 发行版: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/${tag}`)
  console.log(`===================================================================`)
}

main().catch((err) => {
  console.error(`\n❌ [Fatal Error] 同步中断:`, err)
  process.exit(1)
})
