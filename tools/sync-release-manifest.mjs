/**
 * sync-release-manifest.mjs
 * 
 * 作用：在 GitHub Actions 构建完成后，处理 tauri-action 生成的 latest.json 清单。
 * 为各平台二进制安装包下载链接注入国内高速 CDN 镜像加速前缀（方案 C），
 * 并覆盖更新 latest.json 与 latest-china.json，供 GitHub Releases 直接分发。
 * 如果配置了 SUPABASE_SERVICE_ROLE_KEY，亦可同步推送到 Supabase 作为冗余源（非必需）。
 */
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'

async function run() {
  const supabaseUrl = (process.env.SUPABASE_URL || 'https://litlnyxkmcupbvigfrwj.supabase.co').replace(/\/+$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const manifestPath = process.env.MANIFEST_PATH || 'latest.json'
  const mirrorPrefix = process.env.CHINA_MIRROR_PREFIX || ''

  console.log(`[Sync] Reading release manifest from: ${manifestPath}`)

  let manifestContent = ''
  try {
    manifestContent = await readFile(manifestPath, 'utf8')
  } catch (err) {
    console.error(`[Sync] Error reading manifest:`, err)
    process.exit(1)
  }

  let manifest
  try {
    manifest = JSON.parse(manifestContent)
  } catch (err) {
    console.error(`[Sync] Failed to parse JSON manifest:`, err)
    process.exit(1)
  }

  console.log(`[Sync] Manifest version: ${manifest.version || 'unknown'}`)

  // 1. 为安装包链接注入高速 CDN 镜像加速前缀（国内免翻墙高速直连 10~25 MB/s）
  if (manifest.platforms && mirrorPrefix) {
    for (const [platformKey, platformData] of Object.entries(manifest.platforms)) {
      if (platformData && platformData.url && platformData.url.startsWith('https://github.com/')) {
        const acceleratedUrl = `${mirrorPrefix}${platformData.url}`
        console.log(`[Sync] Accelerated ${platformKey}:`)
        console.log(`       Direct:      ${platformData.url}`)
        console.log(`       Accelerated: ${acceleratedUrl}`)
        platformData.url = acceleratedUrl
      }
    }
  }

  const updatedJson = JSON.stringify(manifest, null, 2)

  // 覆盖原 latest.json（供 GitHub Release 重新上传覆盖）并写入 latest-china.json
  await writeFile(manifestPath, updatedJson, 'utf8')
  await writeFile('latest-china.json', updatedJson, 'utf8')
  console.log(`[Sync] Successfully updated ${manifestPath} and latest-china.json`)

  // 2. 可选：若配置了 Supabase Service Key，同步推送到 Supabase Storage 作为备用
  if (serviceKey) {
    console.log(`[Sync] Optional Supabase sync enabled: ${supabaseUrl}`)
    const uploadUrl = `${supabaseUrl}/storage/v1/object/ota-releases/latest.json`

    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: updatedJson,
      })

      if (!response.ok) {
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: updatedJson,
        })
        if (putRes.ok) {
          console.log('[Sync] Synced to Supabase via PUT')
        } else {
          console.warn('[Sync] Optional Supabase upload failed, ignoring.')
        }
      } else {
        console.log('[Sync] Synced to Supabase via POST')
      }
    } catch (err) {
      console.warn('[Sync] Supabase sync network error (optional, ignoring):', err?.message || err)
    }
  } else {
    console.log('[Sync] Option C active: Pure GitHub Releases + CDN mirror mode. No Supabase storage needed.')
  }

  console.log('[Sync] Manifest synchronization completed successfully.')
}

run().catch((err) => {
  console.error('[Sync] Fatal error:', err)
  process.exit(1)
})
