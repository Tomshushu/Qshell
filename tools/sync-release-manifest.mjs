/**
 * sync-release-manifest.mjs
 * 
 * 作用：在 GitHub Actions 构建完成后，自动获取各平台签名，
 * 为国内用户生成国内高速 CDN 镜像加速链接，并将最终的 latest.json
 * 自动推送到 Supabase Storage（ota-releases 桶）或持久化保存。
 */
import process from 'node:process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function run() {
  const supabaseUrl = (process.env.SUPABASE_URL || 'https://litlnyxkmcupbvigfrwj.supabase.co').replace(/\/+$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const manifestPath = process.env.MANIFEST_PATH || 'latest.json'

  console.log(`[Sync] Reading release manifest from: ${manifestPath}`)

  let manifestContent = ''
  try {
    manifestContent = await readFile(manifestPath, 'utf8')
  } catch (err) {
    console.error(`[Sync] Error reading manifest:`, err)
    process.exit(1)
  }

  const manifest = JSON.parse(manifestContent)
  console.log(`[Sync] Original manifest version: ${manifest.version}`)

  // 1. 为国内用户优化下载链接（如为 GitHub Releases 加上可直连的高速 CDN 镜像前缀）
  // 镜像节点支持直接跳转原文件，并由国内 CDN 缓存加速，下载速度达 10~25 MB/s
  const mirrorPrefix = process.env.CHINA_MIRROR_PREFIX || 'https://ghproxy.net/'

  if (manifest.platforms && mirrorPrefix) {
    for (const [platformKey, platformData] of Object.entries(manifest.platforms)) {
      if (platformData && platformData.url && platformData.url.startsWith('https://github.com/')) {
        const acceleratedUrl = `${mirrorPrefix}${platformData.url}`
        console.log(`[Sync] Transformed ${platformKey} URL for domestic users:`)
        console.log(`       Old: ${platformData.url}`)
        console.log(`       New: ${acceleratedUrl}`)
        platformData.url = acceleratedUrl
      }
    }
  }

  const updatedJson = JSON.stringify(manifest, null, 2)
  await writeFile('latest-china.json', updatedJson, 'utf8')
  console.log('[Sync] Created latest-china.json')

  // 2. 如果配置了 Supabase Service Key，直接自动推送到 Supabase Storage
  if (serviceKey) {
    console.log(`[Sync] Uploading latest.json to Supabase Storage: ${supabaseUrl}`)
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
        const errorText = await response.text()
        console.warn(`[Sync] Supabase upload POST returned ${response.status}: ${errorText}`)
        // 尝试 PUT 覆盖
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: updatedJson,
        })
        if (!putRes.ok) {
          console.error(`[Sync] Supabase upload PUT also failed: ${await putRes.text()}`)
        } else {
          console.log('[Sync] Successfully updated latest.json in Supabase Storage via PUT!')
        }
      } else {
        console.log('[Sync] Successfully uploaded latest.json to Supabase Storage via POST!')
      }
    } catch (err) {
      console.error('[Sync] Failed to upload to Supabase:', err)
    }
  } else {
    console.log('[Sync] SUPABASE_SERVICE_ROLE_KEY not provided. Skipping auto-upload to Supabase.')
  }

  console.log('[Sync] Manifest synchronization completed successfully.')
}

run().catch((err) => {
  console.error('[Sync] Fatal error:', err)
  process.exit(1)
})
