import type { ComponentType, ReactNode } from 'react'
import {
  ArchiveFileIcon,
  AudioFileIcon,
  CodeFileIcon,
  ConfigFileIcon,
  DatabaseFileIcon,
  DocFileIcon,
  FolderCreativeIcon,
  FolderUpCreativeIcon,
  GenericFileIcon,
  ImageFileIcon,
  KeyCertFileIcon,
  MarkdownFileIcon,
  PdfFileIcon,
  PythonFileIcon,
  ScriptCodeFileIcon,
  SheetFileIcon,
  ShellScriptFileIcon,
  VideoFileIcon,
} from '../../ui/file-icons'
import { renderFileIcon as renderThemedFileIcon } from '@/components/file-icons'

export interface LocalFile {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modified: string
}

/** 图标/类型判定所需的最小文件信息（本地 LocalFile 与远程 FileEntry 均满足） */
export interface FileLike {
  name: string
  isDirectory: boolean
  path?: string
  isSymlink?: boolean
  size?: number
  modified?: string
  mimeType?: string
}

export interface TreeNode {
  path: string
  name: string
  children: TreeNode[]
  loaded: boolean
  loading: boolean
}

export interface QuickAccessEntry {
  name: string
  type: string
  path: string
  platform: string
}

export type FileIconComponent = ComponentType<{ className?: string; fill?: string }>

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'avif'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'])
const VIDEO_EXT = new Set(['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'])
export const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar', 'tgz', 'tbz2', 'txz', 'z', 'iso', 'dmg', 'war', 'cab', 'ear', 'apk', 'nupkg', 'whl'])
const PYTHON_EXT = new Set(['py', 'pyw', 'ipynb'])
const SCRIPT_EXT = new Set(['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'])
const SHELL_EXT = new Set(['sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'])
const CONFIG_EXT = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'xml', 'properties'])
const KEY_CERT_EXT = new Set(['pem', 'key', 'crt', 'cer', 'pub', 'p12', 'pfx', 'der', 'csr', 'ca'])
const DATABASE_EXT = new Set(['sql', 'db', 'sqlite', 'sqlite3', 'dump'])
const PDF_EXT = new Set(['pdf'])
const MD_EXT = new Set(['md', 'markdown'])
const CODE_EXT = new Set([
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'go', 'rs', 'rb', 'php',
  'html', 'css', 'scss', 'less', 'vue', 'svelte', 'swift', 'kt', 'dart', 'java', 'lua',
])
const SHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods'])
const DOC_EXT = new Set(['doc', 'docx', 'rtf', 'odt', 'txt', 'log'])

export function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

/** 扩展名简写别名 */
export const getFileExt = getFileExtension

/** 判断文件预览类型 */
export function getFileKind(name: string):
  | 'image' | 'pdf' | 'video' | 'audio' | 'text'
  | 'docx' | 'spreadsheet' | 'legacy_doc'
  | 'unsupported' {
  const ext = getFileExtension(name)
  if (DOCX_EXT_SET.has(ext)) return 'docx'
  if (DOC_LEGACY_EXT_SET.has(ext)) return 'legacy_doc'
  if (SPREADSHEET_EXT_SET.has(ext)) return 'spreadsheet'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (TEXT_EXT_SET.has(ext)) return 'text'
  return 'unsupported'
}

export function getFileIconMeta(file: FileLike): { icon: FileIconComponent; className: string; fill?: string } {
  if (file.name === '..') {
    return { icon: FolderUpCreativeIcon, className: 'text-sky-500 dark:text-sky-400' }
  }
  if (file.isDirectory) {
    return { icon: FolderCreativeIcon, className: 'text-blue-500 dark:text-blue-400' }
  }
  const ext = getFileExtension(file.name)
  if (ARCHIVE_EXT.has(ext)) return { icon: ArchiveFileIcon, className: 'text-amber-500 dark:text-amber-400' }
  if (PDF_EXT.has(ext)) return { icon: PdfFileIcon, className: 'text-rose-500 dark:text-rose-400' }
  if (PYTHON_EXT.has(ext)) return { icon: PythonFileIcon, className: 'text-sky-500 dark:text-sky-400' }
  if (SHELL_EXT.has(ext)) return { icon: ShellScriptFileIcon, className: 'text-slate-500 dark:text-slate-400' }
  if (SCRIPT_EXT.has(ext)) return { icon: ScriptCodeFileIcon, className: 'text-yellow-500 dark:text-yellow-400' }
  if (CONFIG_EXT.has(ext)) return { icon: ConfigFileIcon, className: 'text-cyan-500 dark:text-cyan-400' }
  if (KEY_CERT_EXT.has(ext)) return { icon: KeyCertFileIcon, className: 'text-amber-500 dark:text-amber-400' }
  if (DATABASE_EXT.has(ext)) return { icon: DatabaseFileIcon, className: 'text-teal-500 dark:text-teal-400' }
  if (MD_EXT.has(ext)) return { icon: MarkdownFileIcon, className: 'text-indigo-500 dark:text-indigo-400' }
  if (IMAGE_EXT.has(ext)) return { icon: ImageFileIcon, className: 'text-pink-500 dark:text-pink-400' }
  if (AUDIO_EXT.has(ext)) return { icon: AudioFileIcon, className: 'text-purple-500 dark:text-purple-400' }
  if (VIDEO_EXT.has(ext)) return { icon: VideoFileIcon, className: 'text-violet-500 dark:text-violet-400' }
  if (SHEET_EXT.has(ext)) return { icon: SheetFileIcon, className: 'text-emerald-500 dark:text-emerald-400' }
  if (CODE_EXT.has(ext)) return { icon: CodeFileIcon, className: 'text-emerald-500 dark:text-emerald-400' }
  if (DOC_EXT.has(ext)) return { icon: DocFileIcon, className: 'text-blue-500 dark:text-blue-400' }
  return { icon: GenericFileIcon, className: 'text-slate-400 dark:text-slate-500' }
}

export function renderFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  return renderThemedFileIcon(file, size)
}

export function getFileTypeLabel(file: LocalFile): string {
  if (file.isDirectory) return 'ft_folder'
  const ext = getFileExtension(file.name)
  if (!ext) return 'ft_file'
  if (ext === 'pdf') return 'ft_pdf'
  if (['doc', 'docx'].includes(ext)) return 'ft_word'
  if (['xls', 'xlsx'].includes(ext)) return 'ft_excel'
  if (ext === 'csv') return 'ft_csv'
  if (ext === 'txt') return 'ft_text'
  if (ext === 'md') return 'ft_text'
  if (IMAGE_EXT.has(ext)) return 'ft_image'
  if (ARCHIVE_EXT.has(ext)) return 'ft_archive'
  if (CODE_EXT.has(ext)) return 'ft_code'
  return 'ft_unknown'
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

export function findTreeNode(root: TreeNode, path: string): TreeNode | null {
  if (pathsEqual(root.path, path)) return root
  for (const child of root.children) {
    const found = findTreeNode(child, path)
    if (found) return found
  }
  return null
}

export function updateTreeNode(
  root: TreeNode,
  path: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode {
  if (pathsEqual(root.path, path)) return updater(root)
  return {
    ...root,
    children: root.children.map(child => updateTreeNode(child, path, updater)),
  }
}

export function localFilesToTreeNodes(files: LocalFile[]): TreeNode[] {
  return files
    .filter(f => f.isDirectory)
    .map(d => ({
      path: d.path,
      name: d.name,
      children: [],
      loaded: false,
      loading: false,
    }))
}

export function getParentPath(filePath: string): string | null {
  const normalized = filePath.replace(/[/\\]+$/, '')
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (idx <= 0) {
    if (normalized.length <= 3 && /^[A-Za-z]:\\?$/.test(normalized)) return null
    return normalized.startsWith('/') ? '/' : null
  }
  const parent = normalized.slice(0, idx)
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent || '/'
}

export function getPathBreadcrumbs(path: string): { label: string; path: string }[] {
  if (!path) return []
  const isWin = path.includes('\\')
  const sep = isWin ? '\\' : '/'
  const crumbs: { label: string; path: string }[] = []

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    const drive = path.slice(0, 3)
    crumbs.push({ label: drive.replace('\\', ''), path: drive })
    const rest = path.slice(3).split(/[/\\]/).filter(Boolean)
    let acc = drive
    for (const part of rest) {
      acc = acc.endsWith(sep) ? acc + part : acc + sep + part
      crumbs.push({ label: part, path: acc })
    }
    return crumbs
  }

  if (path === '/') return [{ label: '/', path: '/' }]
  const parts = path.split('/').filter(Boolean)
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    crumbs.push({ label: part, path: acc })
  }
  return crumbs
}

export function findContainingRoot(targetPath: string, roots: string[]): string {
  const normalized = targetPath.replace(/\\/g, '/').toLowerCase()
  for (const root of roots) {
    const r = root.replace(/\\/g, '/').toLowerCase()
    if (normalized === r || normalized.startsWith(r.endsWith('/') ? r : `${r}/`)) {
      return root
    }
  }
  return roots[0] || ''
}

export function buildDescendantPaths(rootPath: string, targetPath: string): string[] {
  if (!targetPath || pathsEqual(rootPath, targetPath)) return [rootPath]
  const rootNorm = rootPath.replace(/\\/g, '/')
  const targetNorm = targetPath.replace(/\\/g, '/')
  if (!targetNorm.toLowerCase().startsWith(rootNorm.toLowerCase())) return [rootPath]

  const relative = targetNorm.slice(rootNorm.length).replace(/^[/\\]+/, '')
  const parts = relative.split(/[/\\]/).filter(Boolean)
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const paths = [rootPath]
  let acc = rootPath.replace(/[/\\]+$/, '')
  for (const part of parts) {
    acc = acc.endsWith(sep) ? acc + part : acc + sep + part
    paths.push(acc)
  }
  return paths
}

export const LAST_LOCAL_PATH_KEY = 'qshell.last-upload-local-path'

export function readLastLocalPath(): string {
  try {
    return localStorage.getItem(LAST_LOCAL_PATH_KEY) || ''
  } catch {
    return ''
  }
}

export function writeLastLocalPath(path: string): void {
  try {
    if (path) localStorage.setItem(LAST_LOCAL_PATH_KEY, path)
  } catch { /* ignore */ }
}

/** 支持在线排版预览的 Word 文档扩展名 */
export const DOCX_EXT_SET = new Set(['docx'])

/** 支持文本提取速览的旧版 Word 文档扩展名 */
export const DOC_LEGACY_EXT_SET = new Set(['doc'])

/** 支持电子表格渲染预览的扩展名（Excel / CSV） */
export const SPREADSHEET_EXT_SET = new Set(['xlsx', 'xls', 'csv', 'tsv'])

/** 常见无扩展名或固定系统日志文件名集合 */
const COMMON_LOG_NAMES = new Set([
  'syslog', 'messages', 'dmesg', 'cron', 'secure', 'maillog', 'boot.log', 'lastlog', 'faillog'
])

/** 判断文件名是否为运维日志（涵盖 .log, .out, .err, .trace, 滚动备份如 app.log.1, syslog 等） */
export function isLogFileName(name: string): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  if (COMMON_LOG_NAMES.has(lower)) return true
  if (/(?:^|[._-])log(?:[._-].*)?$/i.test(lower)) return true
  if (/\.(?:log|out|err|trace|stdout|stderr)(?:\.[\w.-]+)?$/i.test(lower)) return true
  return false
}

/** 支持通用预览的扩展名集合（涵盖运维日志、Office、PDF、压缩包、邮件、图纸、音视频等） */
export const UNIVERSAL_PREVIEW_EXTS = new Set([
  // 运维日志与纯文本
  'log', 'txt', 'out', 'err', 'trace', 'stdout', 'stderr',
  // Office 与文档
  'docx', 'doc', 'xlsx', 'xls', 'csv', 'tsv', 'pptx', 'ppt', 'ofd', 'epub', 'xps',
  // 压缩/归档包（直接在前端解构查看目录与内容）
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'tbz2', 'xz', 'txz', 'jar', 'war', 'ear', 'apk', 'nupkg', 'whl', 'z', 'cab',
  // 邮件
  'eml', 'msg',
  // 图纸与思维导图
  'drawio', 'xmind',
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tif', 'tiff', 'psd', 'heic', 'avif',
  // 版式 PDF
  'pdf',
  // 视频
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'flv', 'm4v', 'm3u8',
  // 音频
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus',
])

/** 判断文件名或扩展名是否支持通用只读预览（支持复合后缀如 .tar.gz 与运维日志） */
export function isUniversalPreviewSupported(name: string): boolean {
  if (isLogFileName(name)) return true
  if (/\.(?:zip|tar|tgz|tar\.gz|tbz2|tar\.bz2|txz|tar\.xz|gz|bz2|xz|7z|rar|jar|war|ear|apk|nupkg|whl)$/i.test(name)) {
    return true
  }
  const ext = getFileExtension(name)
  return UNIVERSAL_PREVIEW_EXTS.has(ext)
}

/** 支持网页沙箱渲染预览的扩展名 */
export const HTML_EXT_SET = new Set(['html', 'htm'])

/** 全量支持查看与编辑的代码及文本文件扩展名集合（涵盖 30+ 种主流语言与常见配置） */
export const TEXT_EXT_SET = new Set([
  // 基础文本与标记与运维日志
  'txt', 'md', 'markdown', 'log', 'rtf', 'out', 'err', 'trace', 'stdout', 'stderr',
  // 网页前端
  'html', 'htm', 'css', 'scss', 'less', 'sass',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte',
  // 后端与系统语言
  'py', 'pyw', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'cs',
  'go', 'rs', 'php', 'rb', 'kt', 'kts', 'swift', 'dart', 'lua',
  'r', 'jl', 'ex', 'exs', 'erl', 'scala', 'pl', 'pm', 'tcl', 'zig', 'nim',
  // Shell 与自动化脚本
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
  // 数据格式与配置文件
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'svg',
  'ini', 'conf', 'config', 'properties', 'env', 'cfg', 'cnf', 'cf',
  'csv', 'tsv',
  // 数据库与接口协议
  'sql', 'graphql', 'gql', 'prisma', 'proto',
  // 工程、构建与运维配置
  'dockerfile', 'containerfile', 'makefile', 'cmake', 'gradle', 'sbt',
  'gemspec', 'gemfile', 'nginx', 'service', 'timer', 'socket', 'target', 'mount',
  'diff', 'patch', 'gitignore', 'gitattributes', 'editorconfig', 'npmignore', 'dockerignore',
  // 常见 Linux 系统管理配置
  'hosts', 'passwd', 'shadow', 'group', 'sudoers', 'fstab',
  'vimrc', 'bashrc', 'zshrc', 'profile', 'bash_profile',
  'npmrc', 'yarnrc', 'condarc', 'pip',
])

/** 常见二进制文件扩展名集合（禁止作为纯文本预览与编辑） */
export const BINARY_EXT_SET = new Set([
  // Microsoft Office & 文档
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key',
  'wps', 'et', 'dps', 'vsd', 'vsdx', 'pub', 'rtf', 'mpp',
  // 压缩/归档包
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz', 'zst', 'lz4', 'lzma',
  'cab', 'iso', 'dmg', 'img', 'vmdk', 'qcow2', 'apk', 'ipa', 'aar',
  // 可执行文件与系统二进制
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'msi', 'sys', 'drv', 'cpl', 'scr', 'ocx', 'com',
  'elf', 'out', 'app', 'deb', 'rpm',
  // 字节码与编译目标文件
  'class', 'jar', 'war', 'ear', 'pyc', 'pyo', 'pyd', 'wasm', 'o', 'obj', 'a', 'lib',
  // 数据库文件
  'db', 'sqlite', 'sqlite3', 'db3', 's3db', 'mdb', 'accdb', 'rdb', 'ibd', 'frm', 'myd', 'myi',
  // 字体文件
  'ttf', 'otf', 'woff', 'woff2', 'eot', 'fon',
  // 密钥与凭证二进制
  'keystore', 'jks', 'p12', 'pfx', 'der',
  // 设计与工程二进制
  'psd', 'ai', 'eps', 'indd', 'prproj', 'aep', 'sketch', 'fig',
  // 其它
  'torrent', 'pak', 'asset', 'unity3d', 'bak',
])

/** 检测文本内容是否实质为二进制数据（包含 \0 空字符或乱码字符比例过高） */
export function isBinaryContent(text: string): boolean {
  if (!text) return false
  const sample = text.slice(0, 4000)
  if (sample.includes('\0')) return true
  let suspiciousCount = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      suspiciousCount++
    }
  }
  return suspiciousCount / sample.length > 0.03
}

/** 为重名冲突生成副本文件名（例如 file.txt -> file (1).txt） */
export function generateDuplicateName(originalName: string, existingNames: Set<string>): string {
  const dotIdx = originalName.lastIndexOf('.')
  const stem = dotIdx > 0 ? originalName.substring(0, dotIdx) : originalName
  const ext = dotIdx > 0 ? originalName.substring(dotIdx) : ''
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!existingNames.has(candidate)) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

/** 判断文件是否为压缩归档文件（支持一键解压） */
export function isArchiveFile(fileName: string): boolean {
  const ext = getFileExt(fileName)
  return ARCHIVE_EXT.has(ext)
}

