// 构建 Windows 便携 zip：将 release 目录下的 qshell.exe 与 resources 打包为
// <ProductName>_<version>_x64-portable.zip，输出到 src-tauri/target/release/bundle/。
// 仅依赖系统 PowerShell 的 Compress-Archive（Windows 自带），无需额外 npm 依赖。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

const pkg = readJson(join(root, 'package.json'))
const tauriConf = readJson(join(root, 'src-tauri', 'tauri.conf.json'))
const productName = tauriConf.productName || 'Qshell'
const version = pkg.version || '1.0.0'

const releaseDir = join(root, 'src-tauri', 'target', 'release')
const exePath = join(releaseDir, 'qshell.exe')
const resourcesDir = join(releaseDir, 'resources')
const bundleDir = join(releaseDir, '..', 'bundle')
const zipName = `${productName}_${version}_x64-portable.zip`
const zipPath = join(bundleDir, zipName)

if (!existsSync(exePath)) {
  console.error(`[build-win-zip] 未找到 ${exePath}，请先执行构建（npm run build:win）。`)
  process.exit(1)
}

mkdirSync(bundleDir, { recursive: true })

// 仅当 resources 目录存在时才一并打包（桌面背景等外置资源）
const paths = existsSync(resourcesDir)
  ? `'qshell.exe','resources'`
  : `'qshell.exe'`

const ps = `Compress-Archive -Path ${paths} -DestinationPath '${zipPath}' -Force`
console.log(`[build-win-zip] 打包便携 zip -> ${zipPath}`)
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
  cwd: releaseDir,
  stdio: 'inherit',
})

console.log(`[build-win-zip] 完成：${zipName}`)
