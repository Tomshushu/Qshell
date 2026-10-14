const http = require('http')
const fs = require('fs')
const { execSync } = require('child_process')

const GITEE_TOKEN = '12c9b9f0edf788cf0e5c308134e5e316'
const GITEE_OWNER = 'Tom-shushu'
const GITEE_REPO = 'qshell'
const GITHUB_REPO = 'Tomshushu/Qshell'
const WEBHOOK_SECRET = 'Qshell_Release_Sync_2026'

// 国内高速通道多路镜像源（顺序轮询 fallback）
const CDN_PROXIES = [
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  'https://github.moeyy.xyz/',
  ''
]

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('pong')
  }

  if (req.method !== 'POST') {
    res.writeHead(405)
    return res.end('Method Not Allowed')
  }

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}')
      if (payload.secret !== WEBHOOK_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ code: 403, message: 'Forbidden' }))
      }

      const tag = payload.tag
      if (!tag) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ code: 400, message: 'Missing tag' }))
      }

      const cleanVer = tag.replace(/^v/, '')
      console.log(`[FC] Starting sync for ${tag} (clean: ${cleanVer})...`)

      const releaseBody = `## 🚀 Qshell ${tag} 正式版本发布

> 现代化极速终端与多协议服务器管理工作台。国内高速镜像托管发布。

### 📦 国内免翻墙极速下载通道 (推荐)

| 操作系统与架构 | 安装包类型 | 国内极速直链 (10~25MB/s) |
| :--- | :--- | :--- |
| **Windows 64位** | 安装包 (.exe) | [⚡ 点击极速下载](https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/Qshell_${cleanVer}_x64-setup.exe) |
| **macOS Apple Silicon** | 镜像包 (.dmg) | [⚡ 点击极速下载](https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/Qshell_${cleanVer}_aarch64.dmg) |
| **macOS 压缩包** | 应用包 (.app.tar.gz) | [⚡ 点击极速下载](https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/Qshell_${cleanVer}_aarch64.app.tar.gz) |
| **Linux (全平台通用)** | 便携版 (.AppImage) | [⚡ 点击极速下载](https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/Qshell_${cleanVer}_amd64.AppImage) |
| **Linux (Debian/Ubuntu)** | 安装包 (.deb) | [⚡ 点击极速下载](https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/Qshell_${cleanVer}_amd64.deb) |

---
*注：Qshell 客户端内置智能动态双通道测速，更新时将自动优选国内最畅通的直连节点。*`

      // 1. 获取或创建 Gitee Release（带完整极速下载表格）
      const releasesRes = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases?access_token=${GITEE_TOKEN}`)
      const releases = await releasesRes.json()
      let giteeRel = Array.isArray(releases) ? releases.find(r => r.tag_name === tag) : null

      if (!giteeRel) {
        console.log(`[FC] Creating Gitee release for ${tag}...`)
        const createRes = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases?access_token=${GITEE_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tag_name: tag,
            name: `Qshell ${tag}`,
            body: releaseBody,
            target_commitish: 'main'
          })
        })
        giteeRel = await createRes.json()
      } else {
        // 更新正文为最新的国内直链表格
        await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${giteeRel.id}?access_token=${GITEE_TOKEN}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Qshell ${tag}`,
            body: releaseBody
          })
        }).catch(() => {})
      }

      // 2. 获取已存在的附件，建立防重复映射
      const attachesRes = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${giteeRel.id}/attach_files?access_token=${GITEE_TOKEN}`)
      const existingAttaches = await attachesRes.json()
      const existingMap = new Set(Array.isArray(existingAttaches) ? existingAttaches.map(a => a.name) : [])

      // 3. 拉取官方 latest.json 构建待同步清单（多源轮询）
      let manifest = null
      for (const prefix of CDN_PROXIES) {
        const mirrorUrl = `${prefix}https://github.com/${GITHUB_REPO}/releases/download/${tag}/latest.json`
        try {
          const mRes = await fetch(mirrorUrl)
          if (mRes.ok) {
            const raw = await mRes.text()
            if (raw.length > 50 && !raw.includes('Not Found') && !raw.includes('<html')) {
              manifest = JSON.parse(raw)
              console.log(`[FC] Successfully loaded latest.json via ${prefix || 'direct'}`)
              break
            }
          }
        } catch {}
      }

      const candidateFiles = new Set([
        `Qshell_${cleanVer}_x64-setup.exe`,
        `Qshell_${cleanVer}_x64-setup.exe.sig`,
        `Qshell_${cleanVer}_aarch64.dmg`,
        `Qshell_${cleanVer}_aarch64.app.tar.gz`,
        `Qshell_${cleanVer}_aarch64.app.tar.gz.sig`,
        `Qshell_${cleanVer}_amd64.deb`,
        `Qshell_${cleanVer}_amd64.deb.sig`,
        `Qshell_${cleanVer}_amd64.AppImage`,
        `Qshell_${cleanVer}_amd64.AppImage.sig`,
      ])

      let uploaded = 0
      let skipped = 0

      // 4. 多镜像通道下载并流式上传
      for (const fname of candidateFiles) {
        if (existingMap.has(fname)) {
          skipped++
          continue
        }

        const srcPath = `/tmp/dl_${Date.now()}_${fname.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        let downloaded = false

        for (const prefix of CDN_PROXIES) {
          const dlUrl = `${prefix}https://github.com/${GITHUB_REPO}/releases/download/${tag}/${fname}`
          try {
            execSync(`curl -sL --connect-timeout 10 --max-time 180 "${dlUrl}" -o "${srcPath}"`)
            if (fs.existsSync(srcPath)) {
              const stat = fs.statSync(srcPath)
              const minValidSize = fname.endsWith('.sig') ? 40 : 1000
              if (stat.size >= minValidSize) {
                const head = fs.readFileSync(srcPath, { encoding: 'utf8', flag: 'r' }).substring(0, 100)
                if (!head.includes('Not Found') && !head.includes('<html') && !head.includes('404')) {
                  downloaded = true
                  console.log(`[FC] Downloaded ${fname} (${stat.size} bytes) via ${prefix || 'direct'}`)
                  break
                }
              }
              try { fs.unlinkSync(srcPath) } catch {}
            }
          } catch {
            if (fs.existsSync(srcPath)) try { fs.unlinkSync(srcPath) } catch {}
          }
        }

        if (downloaded) {
          try {
            console.log(`[FC] Uploading ${fname} to Gitee...`)
            execSync(`curl -s -X POST "https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${giteeRel.id}/attach_files?access_token=${GITEE_TOKEN}" -F "file=@${srcPath};filename=${fname}"`)
            existingMap.add(fname)
            uploaded++
            console.log(`[FC] Uploaded ${fname} successfully!`)
          } catch (err) {
            console.error(`[FC] Failed to upload ${fname}:`, err.message)
          } finally {
            if (fs.existsSync(srcPath)) try { fs.unlinkSync(srcPath) } catch {}
          }
        } else {
          console.warn(`[FC] Failed to download ${fname} from all mirror sources.`)
        }
      }

      // 5. 生成并挂载 Release 的 latest.json，同时同步推送到 Gitee main 分支根目录
      if (manifest) {
        for (const [_, p] of Object.entries(manifest.platforms || {})) {
          if (p.url) {
            const rawFname = p.url.substring(p.url.lastIndexOf('/') + 1)
            p.url = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/download/${tag}/${rawFname}`
          }
        }
        const manifestStr = JSON.stringify(manifest, null, 2)
        const tmpManifestPath = `/tmp/latest_${Date.now()}.json`
        fs.writeFileSync(tmpManifestPath, manifestStr, 'utf8')

        // 清理旧附件
        if (Array.isArray(existingAttaches)) {
          for (const a of existingAttaches) {
            if (a.name === 'latest.json' || a.name === 'latest-china.json') {
              await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${giteeRel.id}/attach_files/${a.id}?access_token=${GITEE_TOKEN}`, { method: 'DELETE' }).catch(() => {})
            }
          }
        }

        // 上传到 Release 附件
        execSync(`curl -s -X POST "https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${giteeRel.id}/attach_files?access_token=${GITEE_TOKEN}" -F "file=@${tmpManifestPath};filename=latest.json"`)
        if (fs.existsSync(tmpManifestPath)) try { fs.unlinkSync(tmpManifestPath) } catch {}

        // 自动更新 Gitee main 分支的 latest.json（确保客户端 OTA 检查秒生效）
        try {
          const checkRes = await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/latest.json?ref=main&access_token=${GITEE_TOKEN}`)
          let sha = null
          if (checkRes.ok) {
            const data = await checkRes.json()
            sha = data.sha
          }
          const putBody = {
            content: Buffer.from(manifestStr, 'utf8').toString('base64'),
            message: `chore(release): update latest.json for ${tag} [skip ci]`,
            branch: 'main'
          }
          if (sha) putBody.sha = sha

          await fetch(`https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/latest.json?access_token=${GITEE_TOKEN}`, {
            method: sha ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
          })
          console.log(`[FC] Successfully updated Gitee main branch latest.json for ${tag}`)
        } catch (err) {
          console.warn(`[FC] Failed to update Gitee main latest.json:`, err.message)
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 0, tag, uploaded, skipped }))
    } catch (err) {
      console.error('[FC] Fatal:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 500, error: err.message }))
    }
  })
})

server.listen(9000, () => {
  console.log('Qshell Sync Serverless Webhook listening on port 9000')
})
