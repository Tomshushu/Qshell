/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import type { FileIconTheme, FileLike } from '../../types'

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

/**
 * 快捷方式微角标
 */
function SymlinkBadge() {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 bg-foreground/80 text-background rounded-full p-[1px] shadow-sm ring-1 ring-background">
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 2 L13 2 L13 7 M12.5 2.5 L6 9 M4 4 H3 C2 4 1 5 1 6 V12 C1 13 2 14 3 14 H9 C10 14 11 13 11 12 V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}

/**
 * 极简单色文件夹 SVG (纯粹单色 currentColor 自适应，无任何杂色)
 */
function MinimalFolderIcon({
  isUp,
  isSymlink,
  className = 'h-4 w-4',
}: {
  isUp?: boolean
  isSymlink?: boolean
  className?: string
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative text-foreground/85 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" fill="currentColor" fillOpacity="0.06" />
        {isUp && <path d="M12 11v6m-3-3 3-3 3 3" strokeWidth="1.8" />}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * 极简单色折角文件底板 (纯单线 + 极微透衬底)
 */
function MinimalPaper({
  badge,
  letter,
  size = 'h-4 w-4',
  isSymlink,
}: {
  badge?: ReactNode
  letter?: string
  size?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative text-foreground/85 ${size}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" fill="currentColor" fillOpacity="0.04" />
        <polyline points="14 2 14 8 20 8" fill="currentColor" fillOpacity="0.08" />
        {letter && (
          <text
            x="12"
            y="17"
            textAnchor="middle"
            fill="currentColor"
            stroke="none"
            fontSize={letter.length > 2 ? '5.5' : '7.5'}
            fontWeight="bold"
            fontFamily="system-ui, sans-serif"
          >
            {letter}
          </text>
        )}
        {badge}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * 极简单色徽标容器 (无底板单线直出)
 */
function MinimalOutlineBadge({
  children,
  size = 'h-4 w-4',
  isSymlink,
}: {
  children: ReactNode
  size?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative text-foreground/85 ${size}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-full h-full"
      >
        {children}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * Minimal 图标派发逻辑 (纯粹黑白单色线条美学，零杂色，轮廓清晰)
 */
export function getMinimalFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  const name = file.name || ''
  const lower = name.toLowerCase()
  const ext = getFileExtension(name)

  // 1. Vue (.vue) - 极简单线双 V 标
  if (ext === 'vue') {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <polygon points="3,5 21,5 12,20" fill="currentColor" fillOpacity="0.08" />
        <polygon points="7,5 17,5 12,13" />
      </MinimalOutlineBadge>
    )
  }

  // 2. TypeScript (.ts, .tsx)
  if (ext === 'ts' || ext === 'tsx' || lower.includes('tsconfig')) {
    const isReact = ext === 'tsx'
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize={isReact ? '7' : '9'} fontWeight="bold" fontFamily="system-ui, sans-serif">
          {isReact ? 'TSX' : 'TS'}
        </text>
      </MinimalOutlineBadge>
    )
  }

  // 3. JavaScript (.js, .jsx)
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const isReact = ext === 'jsx'
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize={isReact ? '7' : '9'} fontWeight="bold" fontFamily="system-ui, sans-serif">
          {isReact ? 'JSX' : 'JS'}
        </text>
      </MinimalOutlineBadge>
    )
  }

  // 4. HTML (.html)
  if (['html', 'htm'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <polygon points="4,3 20,3 18.5,19 12,21.5 5.5,19" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" fontWeight="bold">5</text>
      </MinimalOutlineBadge>
    )
  }

  // 5. CSS (.css, .scss, .less)
  if (ext === 'css' || ext === 'less') {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <polygon points="4,3 20,3 18.5,19 12,21.5 5.5,19" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" fontWeight="bold">3</text>
      </MinimalOutlineBadge>
    )
  }
  if (['scss', 'sass'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="14.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6.5" fontWeight="bold">Sass</text>
      </MinimalOutlineBadge>
    )
  }

  // 6. Markdown (.md, .markdown)
  if (['md', 'markdown'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" fill="currentColor" fillOpacity="0.06" />
        <path d="M6 14.5 V9.5 L8.5 12 L11 9.5 V14.5" strokeWidth="1.4" />
        <path d="M16 9.5 V14.5 M14 12.5 L16 14.5 L18 12.5" strokeWidth="1.4" />
      </MinimalOutlineBadge>
    )
  }

  // 7. Python (.py, .ipynb)
  if (['py', 'pyw', 'ipynb'].includes(ext) || lower === 'requirements.txt') {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <path d="M11.5 3 C7 3 5 4.5 5 7 V9 H12 V10 H4 C4 13 6 15 11 15" strokeWidth="1.4" />
        <circle cx="8" cy="5.5" r="0.8" fill="currentColor" stroke="none" />
        <path d="M12.5 21 C17 21 19 19.5 19 17 V15 H12 V14 H20 C20 11 18 9 13 9" strokeWidth="1.4" />
        <circle cx="16" cy="18.5" r="0.8" fill="currentColor" stroke="none" />
      </MinimalOutlineBadge>
    )
  }

  // 8. Shell / 终端脚本 - 单线微视窗 + >_
  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <path d="M6 10 L9.5 12 L6 14" strokeWidth="1.6" />
        <line x1="11" y1="14" x2="16" y2="14" strokeWidth="1.6" />
      </MinimalOutlineBadge>
    )
  }

  // 9. JSON (.json)
  if (['json', 'json5', 'jsonc'].includes(ext) || lower === 'package.json') {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <text x="12" y="15.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" fontWeight="bold" fontFamily="monospace">{'{ }'}</text>
      </MinimalOutlineBadge>
    )
  }

  // 10. 系统与应用通用配置 (.conf, .cfg, .config, .ini, .cnf, .properties) -> 极简单线齿轮
  if (['conf', 'cfg', 'config', 'ini', 'cnf', 'properties'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <circle cx="12" cy="12" r="5.5" strokeWidth="1.4" strokeDasharray="2.5 1.5" fill="none" />
        <circle cx="12" cy="12" r="2.8" />
        <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      </MinimalOutlineBadge>
    )
  }

  // 11. 依赖锁文件与证书安全 (lock, key, pem, crt)
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
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <rect x="7.5" y="10.5" width="9" height="7.5" rx="1.5" />
        <path d="M9.5 10.5 V7.5 A2.5 2.5 0 0 1 14.5 7.5 V10.5" fill="none" />
        <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
      </MinimalOutlineBadge>
    )
  }

  // ==========================================
  // Office 与核心文档 (MinimalPaper 单色折角卡片)
  // ==========================================

  // 11. Word 文档 (.docx, .doc, .rtf)
  if (['doc', 'docx', 'rtf', 'odt', 'wps'].includes(ext)) {
    return <MinimalPaper size={size} isSymlink={file.isSymlink} letter="W" />
  }

  // 12. Excel 表格 (.xlsx, .xls, .csv)
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'et'].includes(ext)) {
    return <MinimalPaper size={size} isSymlink={file.isSymlink} letter="X" />
  }

  // 13. PowerPoint 演示 (.pptx, .ppt)
  if (['ppt', 'pptx', 'odp', 'dps'].includes(ext)) {
    return <MinimalPaper size={size} isSymlink={file.isSymlink} letter="P" />
  }

  // 14. PDF 文档 (.pdf)
  if (ext === 'pdf') {
    return <MinimalPaper size={size} isSymlink={file.isSymlink} letter="PDF" />
  }

  // 15. 纯文本与系统日志 (.txt, .log)
  if (['txt', 'log', 'text', 'out', 'err', 'diff', 'patch'].includes(ext)) {
    return (
      <MinimalPaper
        size={size}
        isSymlink={file.isSymlink}
        badge={
          <g strokeWidth="1.3">
            <line x1="7" y1="11" x2="14" y2="11" />
            <line x1="7" y1="14" x2="17" y2="14" />
            <line x1="7" y1="17" x2="13" y2="17" />
          </g>
        }
      />
    )
  }

  // 16. 归档与压缩包 (.zip, .tar, .gz, .7z)
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="1.5 1.5" />
        <rect x="10.5" y="11" width="3" height="3" rx="0.5" fill="currentColor" />
      </MinimalOutlineBadge>
    )
  }

  // 17. 图片文件
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
        <path d="M5 17 L10 11 L14 15 L17 12 L19 17 Z" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.1" />
      </MinimalOutlineBadge>
    )
  }

  // 18. 视频文件
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <polygon points="10,8 16,12 10,16" fill="currentColor" />
      </MinimalOutlineBadge>
    )
  }

  // 19. 音频文件
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <path d="M8 15 A2 2 0 1 0 10 13 V7 L16 5.5 V11 A2 2 0 1 0 18 9 V4 L8 6 V15 Z" fill="currentColor" />
      </MinimalOutlineBadge>
    )
  }

  // 20. 二进制与可执行文件 (.exe, .msi, .bin, .dll)
  if (['exe', 'msi', 'bin', 'dll', 'so', 'dylib', 'appimage', 'apk', 'deb', 'rpm'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <rect x="3" y="3" width="18" height="4.5" fill="currentColor" fillOpacity="0.2" />
        <text x="12" y="15" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6.5" fontWeight="bold" fontFamily="monospace">EXE</text>
      </MinimalOutlineBadge>
    )
  }

  // 21. 数据库 SQL (.sql, .db, .sqlite)
  if (['sql', 'db', 'sqlite', 'sqlite3', 'dump'].includes(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <ellipse cx="12" cy="7" rx="7" ry="2.5" />
        <path d="M5 7 V12 C5 13.5 8 14.5 12 14.5 C16 14.5 19 13.5 19 12 V7" fill="none" />
        <path d="M5 12 V17 C5 18.5 8 19.5 12 19.5 C16 19.5 19 18.5 19 17 V12" fill="none" />
      </MinimalOutlineBadge>
    )
  }

  // 22. 通用其它代码
  const OTHER_CODE_EXT = new Set(['go', 'rs', 'c', 'cpp', 'java', 'kt', 'swift', 'rb', 'php', 'lua'])
  if (OTHER_CODE_EXT.has(ext)) {
    return (
      <MinimalOutlineBadge size={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" fillOpacity="0.06" />
        <path d="M8 9 L5 12 L8 15 M16 9 L19 12 L16 15 M13 7 L11 17" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </MinimalOutlineBadge>
    )
  }

  // 23. 未知或普通文件
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative text-foreground/75 ${size}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" fill="currentColor" fillOpacity="0.04" />
        <polyline points="14 2 14 8 20 8" fill="currentColor" fillOpacity="0.08" />
        <line x1="8" y1="13" x2="16" y2="13" strokeDasharray="1.5 1.5" opacity="0.5" />
        <line x1="8" y1="16" x2="13" y2="16" strokeDasharray="1.5 1.5" opacity="0.5" />
      </svg>
      {file.isSymlink && <SymlinkBadge />}
    </span>
  )
}

export const minimalTheme: FileIconTheme = {
  id: 'minimal',
  nameKey: 'sftp_icon_theme_minimal',
  descKey: 'sftp_icon_theme_minimal_desc',
  renderPreviewFolder: (size = 'h-6 w-6') => <MinimalFolderIcon className={size} />,
  renderPreviewFile: (size = 'h-6 w-6') => getMinimalFileIcon({ name: 'main.ts', isDirectory: false }, size),
  renderPreviewList: (size = 'h-7 w-7') => [
    <MinimalFolderIcon key="folder" className={size} />,
    <span key="ts" className="inline-flex">{getMinimalFileIcon({ name: 'app.ts', isDirectory: false }, size)}</span>,
    <span key="vue" className="inline-flex">{getMinimalFileIcon({ name: 'App.vue', isDirectory: false }, size)}</span>,
    <span key="word" className="inline-flex">{getMinimalFileIcon({ name: 'doc.docx', isDirectory: false }, size)}</span>,
    <span key="zip" className="inline-flex">{getMinimalFileIcon({ name: 'archive.zip', isDirectory: false }, size)}</span>,
  ],
  renderIcon: (file: FileLike, size = 'h-4 w-4'): ReactNode => {
    if (file.isDirectory) {
      return <MinimalFolderIcon isUp={file.name === '..'} isSymlink={file.isSymlink} className={size} />
    }
    return getMinimalFileIcon(file, size)
  },
}
