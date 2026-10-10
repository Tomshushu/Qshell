/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import type { FileIconTheme, FileLike } from '../../types'

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

/**
 * 智能识别特殊文件夹徽标类型 (Folder Emblem)
 */
function getFolderEmblem(name: string, path?: string): string | null {
  if (name === '..') return 'up'
  const lowerName = name.toLowerCase()
  const lowerPath = (path || '').toLowerCase()

  if (lowerName === 'home' || lowerName.startsWith('~') || lowerPath === '/root' || lowerPath.startsWith('/home/')) {
    if (lowerName === 'home' || lowerName.startsWith('~') || lowerPath === '/root') return 'home'
  }
  if (lowerName === 'desktop') return 'desktop'
  if (lowerName === 'downloads' || lowerName === 'download') return 'download'
  if (lowerName === 'documents' || lowerName === 'document' || lowerName === 'docs') return 'documents'
  if (lowerName === 'pictures' || lowerName === 'photos' || lowerName === 'images') return 'pictures'
  if (lowerName === 'music' || lowerName === 'audio') return 'music'
  if (lowerName === 'videos' || lowerName === 'movies') return 'videos'
  if (['src', 'code', 'git', '.git', 'projects', 'dev'].includes(lowerName)) return 'code'
  if (['etc', 'sys', 'proc', 'system', 'config', '.config'].includes(lowerName)) return 'gear'

  return null
}

/**
 * 快捷方式微角标
 */
function SymlinkBadge() {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 bg-blue-600 text-white rounded-full p-[1px] shadow-sm ring-1 ring-background">
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 2 L13 2 L13 7 M12.5 2.5 L6 9 M4 4 H3 C2 4 1 5 1 6 V12 C1 13 2 14 3 14 H9 C10 14 11 13 11 12 V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}

/**
 * Ubuntu Yaru 经典暖橙文件夹 SVG (统一 32x32 饱满视口，与 Developer 保持 1:1 视觉体量)
 */
function YaruFolderIcon({
  emblem,
  isSymlink,
  className = 'h-4 w-4',
}: {
  emblem?: string | null
  isSymlink?: boolean
  className?: string
}) {
  let emblemSvg: ReactNode = null

  if (emblem === 'up') {
    emblemSvg = (
      <path
        d="M16 13.5 L16 22 M12.5 17 L16 13.5 L19.5 17"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.95"
      />
    )
  } else if (emblem === 'home') {
    emblemSvg = (
      <path
        d="M16 13.5 L22 18.5 H20.5 V23.5 H17.5 V19.5 H14.5 V23.5 H11.5 V18.5 H10 Z"
        fill="white"
        opacity="0.95"
      />
    )
  } else if (emblem === 'download') {
    emblemSvg = (
      <path
        d="M16 13.5 L16 20 M12.5 17 L16 20.5 L19.5 17 M11 23 H21"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.95"
      />
    )
  } else if (emblem === 'desktop') {
    emblemSvg = (
      <g opacity="0.95">
        <rect x="10.5" y="14" width="11" height="7.5" rx="1" stroke="white" strokeWidth="1.5" fill="none" />
        <line x1="16" y1="21.5" x2="16" y2="23.5" stroke="white" strokeWidth="1.5" />
        <line x1="13" y1="23.5" x2="19" y2="23.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    )
  } else if (emblem === 'documents') {
    emblemSvg = (
      <g opacity="0.95">
        <path d="M12.5 13.5 H17.5 L19.5 15.5 V23.5 H12.5 Z" stroke="white" strokeWidth="1.4" fill="none" />
        <line x1="14.5" y1="18" x2="18" y2="18" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="14.5" y1="20.5" x2="18" y2="20.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    )
  } else if (emblem === 'pictures') {
    emblemSvg = (
      <g opacity="0.95">
        <rect x="11" y="14" width="10" height="8" rx="1" stroke="white" strokeWidth="1.4" fill="none" />
        <circle cx="14" cy="16.5" r="1" fill="white" />
        <path d="M11.5 21 L14.5 18 L17 20.5 L18.5 19 L20.5 21" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </g>
    )
  } else if (emblem === 'music') {
    emblemSvg = (
      <path
        d="M13 21 A1.8 1.8 0 1 0 14.8 19.2 V14 L19 13 V18 A1.8 1.8 0 1 0 20.8 16.2 V12 L12 13.2 V19.2"
        fill="white"
        opacity="0.95"
      />
    )
  } else if (emblem === 'videos') {
    emblemSvg = (
      <g opacity="0.95">
        <rect x="11" y="14" width="10" height="8" rx="1" stroke="white" strokeWidth="1.4" fill="none" />
        <polygon points="15,16 18,18 15,20" fill="white" />
      </g>
    )
  } else if (emblem === 'code') {
    emblemSvg = (
      <path
        d="M13.5 16 L11 18 L13.5 20 M18.5 16 L21 18 L18.5 20"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.95"
      />
    )
  } else if (emblem === 'gear') {
    emblemSvg = (
      <g opacity="0.95">
        <circle cx="16" cy="18" r="3.2" stroke="white" strokeWidth="1.4" fill="none" />
        <path d="M16 13.5 v1.5 M16 21 v1.5 M11.5 18 h1.5 M19 18 h1.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    )
  }

  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <linearGradient id="yaru-folder-grad-32" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F06634" />
            <stop offset="100%" stopColor="#D74212" />
          </linearGradient>
        </defs>
        {/* 后背衬板 (饱满 32 视口) */}
        <path
          d="M4 8 C4 6.9 4.9 6 6 6 H13.5 C14.5 6 15.4 6.6 15.8 7.5 L17 9.5 H26 C27.1 9.5 28 10.4 28 11.5 V24.5 C28 25.6 27.1 26.5 26 26.5 H6 C4.9 26.5 4 25.6 4 24.5 Z"
          fill="#C13B0F"
        />
        {/* 内层微露出的白纸页边 */}
        <rect x="6.5" y="8.5" width="19" height="7" rx="1.5" fill="#FAFAFA" opacity="0.92" />
        {/* 标志性 Ubuntu Yaru 大圆角前翻盖 (饱满横跨 3.5 到 28.5) */}
        <path
          d="M3.5 11.5 C3.5 10.4 4.4 9.5 5.5 9.5 H26.5 C27.6 9.5 28.5 10.4 28.5 11.5 V24.5 C28.5 25.6 27.6 26.5 26.5 26.5 H5.5 C4.4 26.5 3.5 25.6 3.5 24.5 Z"
          fill="url(#yaru-folder-grad-32)"
        />
        {/* 顶部微高光反光饰线 */}
        <path d="M5 10.5 H27" stroke="white" strokeWidth="0.8" opacity="0.45" strokeLinecap="round" />
        {emblemSvg}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * Ubuntu Yaru 经典 45° 完美等腰折角白卡纸张 (Classic Ubuntu White Paper)
 * 纯正的 Ubuntu 桌面规范：饱满白页底板 + 45° 等腰折角 + 纯正 Ubuntu 彩色剪影系统
 * 将宽度扩展到 x=4.5 到 27.5，使视觉体量与 Developer 1:1 饱满持平
 */
function YaruWhiteDocPaper({
  badge,
  size = 'h-4 w-4',
  isSymlink,
}: {
  badge: ReactNode
  size?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 柔和阴影 */}
        <path
          d="M4.5 2.5 C4.5 1.5 5.4 0.8 6.5 0.8 H19.5 L27.5 8.8 V29.5 C27.5 30.5 26.6 31.2 25.5 31.2 H6.5 C5.4 31.2 4.5 30.5 4.5 29.5 Z"
          fill="black"
          fillOpacity="0.08"
          transform="translate(0.5, 0.8)"
        />
        {/* 饱满白页纸张：浅色纯白，深色质感深灰 */}
        <path
          d="M4.5 2.5 C4.5 1.5 5.4 0.8 6.5 0.8 H19.5 L27.5 8.8 V29.5 C27.5 30.5 26.6 31.2 25.5 31.2 H6.5 C5.4 31.2 4.5 30.5 4.5 29.5 Z"
          fill="#FFFFFF"
          stroke="#CBD5E1"
          strokeWidth="1.1"
          className="dark:fill-slate-800 dark:stroke-slate-600"
        />
        {/* 45° 等腰三角形内折角 */}
        <path
          d="M19.5 0.8 V8.8 H27.5 Z"
          fill="#E2E8F0"
          stroke="#CBD5E1"
          strokeWidth="1.1"
          strokeLinejoin="round"
          className="dark:fill-slate-700 dark:stroke-slate-600"
        />
        {/* 内部纯正 Ubuntu 彩色剪影系统 */}
        {badge}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * Yaru 文件图标派发逻辑 (纯正 Ubuntu 官方折角白纸 + 高对比度语义剪影)
 */
export function getYaruFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  const name = file.name || ''
  const lower = name.toLowerCase()
  const ext = getFileExtension(name)

  // 1. Vue (.vue) - 官方翠绿/墨色 V 标
  if (ext === 'vue') {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7.5, 11)">
            <polygon points="0,0 17,0 8.5,14" fill="#42B883" />
            <polygon points="4,0 13,0 8.5,8" fill="#35495E" />
          </g>
        }
      />
    )
  }

  // 2. TypeScript (.ts, .tsx) - 微软蓝方块
  if (ext === 'ts' || ext === 'tsx' || lower.includes('tsconfig')) {
    const isReact = ext === 'tsx'
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#3178C6" />
            <text x="9" y="8.5" textAnchor="middle" fill="white" fontSize={isReact ? '6.5' : '7.5'} fontWeight="bold" fontFamily="sans-serif">
              {isReact ? 'TSX' : 'TS'}
            </text>
          </g>
        }
      />
    )
  }

  // 3. JavaScript (.js, .jsx) - 亮黄方块
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const isReact = ext === 'jsx'
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#F7DF1E" />
            <text x="9" y="8.5" textAnchor="middle" fill="#1E293B" fontSize={isReact ? '6.5' : '7.5'} fontWeight="bold" fontFamily="sans-serif">
              {isReact ? 'JSX' : 'JS'}
            </text>
          </g>
        }
      />
    )
  }

  // 4. HTML (.html) - 经典橙盾 5
  if (['html', 'htm'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(9, 10)">
            <polygon points="1,0 13,0 12,13 7,15 2,13" fill="#E44D26" />
            <text x="7" y="10.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">5</text>
          </g>
        }
      />
    )
  }

  // 5. CSS (.css, .scss, .less)
  if (['css', 'less'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(9, 10)">
            <polygon points="1,0 13,0 12,13 7,15 2,13" fill="#1572B6" />
            <text x="7" y="10.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold">3</text>
          </g>
        }
      />
    )
  }
  if (['scss', 'sass'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#CF649A" />
            <text x="9" y="8" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold">Sass</text>
          </g>
        }
      />
    )
  }

  // 6. Markdown (.md, .markdown)
  if (['md', 'markdown'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#0284C7" />
            <path d="M3 8.5 V3 L6 6 L9 3 V8.5 M14 3 V8.5 M11.5 6 L14 8.5 L16.5 6" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </g>
        }
      />
    )
  }

  // 7. Python (.py, .ipynb) - 经典 Ubuntu 蓝黄双蛇
  if (['py', 'pyw', 'ipynb'].includes(ext) || lower === 'requirements.txt') {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(9, 10)">
            <path d="M7 1 C3.5 1 2 2.8 2 4.5 V7 H7 V8 H0 C0 10.5 2.5 12.5 6 12.5 H7 V11 C7 9.8 8.2 8.5 9.5 8.5 H12 C13 8.5 14 7.5 14 6.5 V4.5 C14 2.8 12 1 9 1 H7 Z" fill="#3B82F6" />
            <circle cx="4.5" cy="3.5" r="0.8" fill="white" />
            <path d="M7 15 C10.5 15 12 13.2 12 11.5 V9 H7 V8 H14 C14 5.5 11.5 3.5 8 3.5 H7 V5 C7 6.2 5.8 7.5 4.5 7.5 H2 C1 7.5 0 8.5 0 9.5 V11.5 C0 13.2 2 15 5 15 H7 Z" fill="#FACC15" />
            <circle cx="9.5" cy="12.5" r="0.8" fill="#1E293B" />
          </g>
        }
      />
    )
  }

  // 8. Shell / Bash 脚本 - 标志性 Ubuntu 终端 Aubergine 茄紫背景小视窗
  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 10.5)">
            <rect x="0" y="0" width="18" height="12.5" rx="2" fill="#300A24" />
            <path d="M3 3.5 L6 6.5 L3 9.5" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <line x1="8" y1="9.5" x2="14" y2="9.5" stroke="#22C55E" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        }
      />
    )
  }

  // 9. JSON (.json)
  if (['json', 'json5', 'jsonc'].includes(ext) || lower === 'package.json') {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(9, 10.5)">
            <text x="7" y="10.5" textAnchor="middle" fill="#D97706" fontSize="12" fontWeight="bold" fontFamily="monospace">{'{ }'}</text>
          </g>
        }
      />
    )
  }

  // 10. 系统与应用通用配置 (.conf, .cfg, .config, .ini, .cnf, .properties) -> 经典 Ubuntu 配置齿轮
  if (['conf', 'cfg', 'config', 'ini', 'cnf', 'properties'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8, 10)">
            <circle cx="8" cy="8" r="6" stroke="#E95420" strokeWidth="2" strokeDasharray="3 1.8" fill="none" />
            <circle cx="8" cy="8" r="3.8" fill="#E95420" />
            <circle cx="8" cy="8" r="1.5" fill="white" />
          </g>
        }
      />
    )
  }

  // 11. 依赖锁文件与证书安全 (lock, pem, key, crt)
  const isLockFile =
    ext === 'lock' ||
    lower === 'package-lock.json' ||
    lower === 'pnpm-lock.yaml' ||
    lower === 'yarn.lock' ||
    lower === 'cargo.lock' ||
    lower.endsWith('.lock') ||
    lower.endsWith('-lock.json') ||
    lower.endsWith('-lock.yaml') ||
    ['pem', 'key', 'crt', 'cer', 'pub'].includes(ext)

  if (isLockFile) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8.5, 10.5)">
            <rect x="2" y="4.5" width="11" height="8" rx="1.5" fill="#F59E0B" />
            <path d="M4.5 4.5 V3 A3 3 0 0 1 10.5 3 V4.5" stroke="#D97706" strokeWidth="1.6" fill="none" />
            <circle cx="7.5" cy="8.5" r="1.2" fill="white" />
          </g>
        }
      />
    )
  }

  // ==========================================
  // Office 与核心文档 (YaruWhiteDocPaper 优雅折角白卡纸 + 官方实色徽标)
  // ==========================================

  // 12. Word 文档 (.docx, .doc, .rtf)
  if (['doc', 'docx', 'rtf', 'odt', 'wps'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#185ABD" />
            <text x="9" y="8.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">W</text>
          </g>
        }
      />
    )
  }

  // 13. Excel 表格 (.xlsx, .xls, .csv)
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'et'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#107C41" />
            <text x="9" y="8.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">X</text>
          </g>
        }
      />
    )
  }

  // 14. PowerPoint 演示 (.pptx, .ppt)
  if (['ppt', 'pptx', 'odp', 'dps'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(7, 11)">
            <rect x="0" y="0" width="18" height="11.5" rx="2" fill="#C43E1C" />
            <text x="9" y="8.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="bold" fontFamily="sans-serif">P</text>
          </g>
        }
      />
    )
  }

  // 15. PDF 文档 (.pdf)
  if (ext === 'pdf') {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(6.5, 11)">
            <rect x="0" y="0" width="19" height="11.5" rx="2" fill="#DC2626" />
            <text x="9.5" y="8.2" textAnchor="middle" fill="white" fontSize="6.5" fontWeight="bold" fontFamily="sans-serif">PDF</text>
          </g>
        }
      />
    )
  }

  // 16. 纯文本与系统日志 (.txt, .log)
  if (['txt', 'log', 'text', 'out', 'err', 'diff', 'patch'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8, 12)" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round">
            <line x1="1" y1="1" x2="15" y2="1" />
            <line x1="1" y1="5" x2="15" y2="5" />
            <line x1="1" y1="9" x2="10" y2="9" />
          </g>
        }
      />
    )
  }

  // 17. 归档与压缩包 (.zip, .tar, .gz, .7z) - Ubuntu 标志性金属拉链齿
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(9, 10)">
            <line x1="7" y1="1" x2="7" y2="13" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="4.5" y1="3" x2="9.5" y2="3" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="4.5" y1="6.5" x2="9.5" y2="6.5" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="4.5" y1="10" x2="9.5" y2="10" stroke="#B45309" strokeWidth="1.8" strokeLinecap="round" />
            <rect x="4.5" y="10" width="5" height="4.5" rx="1" fill="#F59E0B" />
          </g>
        }
      />
    )
  }

  // 18. 图片文件
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8, 10.5)">
            <rect x="1" y="1" width="14" height="10" rx="1.5" stroke="#DB2777" strokeWidth="1.3" fill="none" />
            <circle cx="4.5" cy="4" r="1.3" fill="#DB2777" />
            <path d="M2 9 L5.5 5.5 L9 8 L12.5 4.5 L14 6 V10 H2 Z" fill="#F472B6" />
          </g>
        }
      />
    )
  }

  // 19. 视频文件
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8, 10.5)">
            <rect x="1" y="1" width="14" height="10" rx="2" stroke="#7C3AED" strokeWidth="1.4" fill="none" />
            <polygon points="6,4 10.5,6 6,8" fill="#7C3AED" />
          </g>
        }
      />
    )
  }

  // 20. 音频文件
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8, 10.5)">
            <path d="M3 9 A2.5 2.5 0 1 0 5.5 6.5 V1.5 L12.5 0.5 V5 A2.5 2.5 0 1 0 15 2.5 V0 L3 1.5 V9 Z" fill="#9333EA" />
          </g>
        }
      />
    )
  }

  // 21. Linux 安装包与二进制 (.deb, .rpm, .appimage, .bin)
  if (['deb', 'rpm', 'appimage', 'bin', 'so', 'elf', 'exe', 'run'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(6.5, 11)">
            <rect x="0" y="0" width="19" height="11.5" rx="2" fill="#E95420" />
            <text x="9.5" y="8" textAnchor="middle" fill="white" fontSize="5.5" fontWeight="bold" fontFamily="sans-serif">
              {ext === 'deb' ? 'DEB' : ext === 'rpm' ? 'RPM' : 'BIN'}
            </text>
          </g>
        }
      />
    )
  }

  // 22. 数据库 SQL (.sql, .db, .sqlite)
  if (['sql', 'db', 'sqlite', 'sqlite3', 'dump'].includes(ext)) {
    return (
      <YaruWhiteDocPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g transform="translate(8.5, 9.5)">
            <ellipse cx="7.5" cy="3.5" rx="6" ry="2" fill="#0891B2" />
            <path d="M1.5 3.5 V7 C1.5 8.2 4.2 9 7.5 9 C10.8 9 13.5 8.2 13.5 7 V3.5" fill="#06B6D4" />
            <path d="M1.5 7 V10.5 C1.5 11.7 4.2 12.5 7.5 12.5 C10.8 12.5 13.5 11.7 13.5 10.5 V7" fill="#0891B2" />
          </g>
        }
      />
    )
  }

  // 23. 未知文件
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <path d="M4.5 2.5 C4.5 1.5 5.4 0.8 6.5 0.8 H19.5 L27.5 8.8 V29.5 C27.5 30.5 26.6 31.2 25.5 31.2 H6.5 C5.4 31.2 4.5 30.5 4.5 29.5 Z" fill="black" fillOpacity="0.08" transform="translate(0.5, 0.8)" />
        <path d="M4.5 2.5 C4.5 1.5 5.4 0.8 6.5 0.8 H19.5 L27.5 8.8 V29.5 C27.5 30.5 26.6 31.2 25.5 31.2 H6.5 C5.4 31.2 4.5 30.5 4.5 29.5 Z" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.1" className="dark:fill-slate-800 dark:stroke-slate-600" />
        <path d="M19.5 0.8 V8.8 H27.5 Z" fill="#E2E8F0" stroke="#CBD5E1" strokeWidth="1.1" strokeLinejoin="round" className="dark:fill-slate-700 dark:stroke-slate-600" />
        <line x1="9" y1="16" x2="23" y2="16" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="1.5 1.5" opacity="0.6" />
        <line x1="9" y1="20" x2="19" y2="20" stroke="#94A3B8" strokeWidth="1.3" strokeLinecap="round" strokeDasharray="1.5 1.5" opacity="0.6" />
      </svg>
      {file.isSymlink && <SymlinkBadge />}
    </span>
  )
}

export const yaruTheme: FileIconTheme = {
  id: 'yaru',
  nameKey: 'sftp_icon_theme_yaru',
  descKey: 'sftp_icon_theme_yaru_desc',
  renderPreviewFolder: (size = 'h-6 w-6') => <YaruFolderIcon className={size} />,
  renderPreviewFile: (size = 'h-6 w-6') => getYaruFileIcon({ name: 'main.rs', isDirectory: false }, size),
  renderPreviewList: (size = 'h-7 w-7') => [
    <YaruFolderIcon key="folder" className={size} />,
    <span key="ts" className="inline-flex">{getYaruFileIcon({ name: 'app.ts', isDirectory: false }, size)}</span>,
    <span key="vue" className="inline-flex">{getYaruFileIcon({ name: 'App.vue', isDirectory: false }, size)}</span>,
    <span key="word" className="inline-flex">{getYaruFileIcon({ name: 'doc.docx', isDirectory: false }, size)}</span>,
    <span key="zip" className="inline-flex">{getYaruFileIcon({ name: 'archive.zip', isDirectory: false }, size)}</span>,
  ],
  renderIcon: (file: FileLike, size = 'h-4 w-4'): ReactNode => {
    if (file.isDirectory) {
      const emblem = getFolderEmblem(file.name, file.path)
      return <YaruFolderIcon emblem={emblem} isSymlink={file.isSymlink} className={`${size} shrink-0`} />
    }
    return getYaruFileIcon(file, size)
  },
}
