/**
 * tools/bump-version.mjs
 *
 * Qshell 全局版本一键同步工具：
 * 遵循单一事实来源（SSOT）原则，发版时只需指定一个版本号，即可全自动同步：
 * 1. package.json ("version": "x.y.z")
 * 2. src-tauri/tauri.conf.json ("version": "x.y.z")
 * 3. src-tauri/Cargo.toml (version = "x.y.z")
 * 4. README.md (Release-vx.y.z 徽标)
 * 5. 自动运行 cargo check 刷新 src-tauri/Cargo.lock
 *
 * 用法：
 * 1. 方式一（传参一键递增）：
 *    npm run bump 1.0.8        # 直接指定新版本
 *    npm run bump patch        # 自动递增补丁号: 1.0.7 -> 1.0.8
 *    npm run bump minor        # 自动递增次版本: 1.0.7 -> 1.1.0
 *    npm run bump major        # 自动递增主版本: 1.0.7 -> 2.0.0
 *
 * 2. 方式二（仅在 package.json 改一个数字）：
 *    在 package.json 修改 version 后直接执行：
 *    npm run version:sync
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import process from 'node:process'

function parseSemver(ver) {
  const clean = ver.trim().replace(/^v/, '')
  const parts = clean.split('.').map(Number)
  if (parts.length !== 3 || parts.some(n => isNaN(n))) {
    throw new Error(`非法的语义化版本格式: "${ver}" (需符合 X.Y.Z 格式)`)
  }
  return { major: parts[0], minor: parts[1], patch: parts[2], string: clean }
}

function bumpSemver(current, type) {
  const sem = parseSemver(current)
  if (type === 'patch') sem.patch += 1
  else if (type === 'minor') { sem.minor += 1; sem.patch = 0 }
  else if (type === 'major') { sem.major += 1; sem.minor = 0; sem.patch = 0 }
  else throw new Error(`未知的递增类型: ${type} (支持 patch, minor, major)`)
  return `${sem.major}.${sem.minor}.${sem.patch}`
}

async function run() {
  const pkgRaw = await readFile('package.json', 'utf8')
  const pkg = JSON.parse(pkgRaw)
  const currentVersion = pkg.version

  const targetArg = process.argv[2]
  let newVersion = currentVersion

  if (targetArg) {
    if (['patch', 'minor', 'major'].includes(targetArg.toLowerCase())) {
      newVersion = bumpSemver(currentVersion, targetArg.toLowerCase())
    } else {
      newVersion = parseSemver(targetArg).string
    }
  }

  console.log(`=======================================================`)
  console.log(`[Version Tool] 当前版本: ${currentVersion} -> 目标版本: ${newVersion}`)
  console.log(`=======================================================`)

  const updatedFiles = []

  // 1. 更新 package.json
  if (pkg.version !== newVersion || targetArg) {
    pkg.version = newVersion
    await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    updatedFiles.push('package.json')
  }

  // 2. 更新 src-tauri/tauri.conf.json
  const tauriPath = 'src-tauri/tauri.conf.json'
  if (existsSync(tauriPath)) {
    const raw = await readFile(tauriPath, 'utf8')
    const tauriConfig = JSON.parse(raw)
    if (tauriConfig.version !== newVersion) {
      tauriConfig.version = newVersion
      await writeFile(tauriPath, JSON.stringify(tauriConfig, null, 2) + '\n', 'utf8')
      updatedFiles.push(tauriPath)
    }
  }

  // 3. 更新 src-tauri/Cargo.toml
  const cargoTomlPath = 'src-tauri/Cargo.toml'
  if (existsSync(cargoTomlPath)) {
    const raw = await readFile(cargoTomlPath, 'utf8')
    // 仅替换 [package] 下的 version
    const updated = raw.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${newVersion}$2`)
    if (updated !== raw) {
      await writeFile(cargoTomlPath, updated, 'utf8')
      updatedFiles.push(cargoTomlPath)
    }
  }

  // 4. 更新 README.md 中的 Release 徽标
  const readmePath = 'README.md'
  if (existsSync(readmePath)) {
    const raw = await readFile(readmePath, 'utf8')
    const updated = raw.replace(/Release-v[0-9.]+-blue\.svg/g, `Release-v${newVersion}-blue.svg`)
    if (updated !== raw) {
      await writeFile(readmePath, updated, 'utf8')
      updatedFiles.push(readmePath)
    }
  }

  // 5. 自动刷新 src-tauri/Cargo.lock
  console.log(`\n[Cargo] 正在同步 Rust 依赖锁文件 (Cargo.lock)...`)
  try {
    execSync('cargo check --manifest-path src-tauri/Cargo.toml', { stdio: 'inherit' })
    updatedFiles.push('src-tauri/Cargo.lock')
  } catch (err) {
    console.warn(`[Cargo] 警告: cargo check 执行失败，请手动检查 Rust 后端:`, err.message)
  }

  console.log(`\n=======================================================`)
  console.log(`✨ 版本同步成功完成！全局版本统一对齐至: v${newVersion}`)
  console.log(`=======================================================`)
  console.log(`已同步的配置文件清单:`)
  for (const f of updatedFiles) {
    console.log(`  ✓ ${f}`)
  }

  console.log(`\n👉 推荐的下一步发版 Git 命令:`)
  console.log(`  git add -A`)
  console.log(`  git commit -m "release(v${newVersion}): bump version to v${newVersion}"`)
  console.log(`  git tag -a v${newVersion} -m "Release v${newVersion}"`)
  console.log(`  git push origin main && git push origin v${newVersion}`)
  console.log(`  git push gitee main && git push gitee v${newVersion}\n`)
}

run().catch((err) => {
  console.error('[Version Tool] 失败:', err.message)
  process.exit(1)
})
