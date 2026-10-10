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
    <span className="absolute -bottom-0.5 -right-0.5 bg-blue-600 text-white rounded-full p-[1px] shadow-sm ring-1 ring-background">
      <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 2 L13 2 L13 7 M12.5 2.5 L6 9 M4 4 H3 C2 4 1 5 1 6 V12 C1 13 2 14 3 14 H9 C10 14 11 13 11 12 V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}

/**
 * 精密硬朗文件夹 (Precision Wireframe Tech Folder)
 * 区别于实色块，采用科技线框 + 微透机甲背板
 */
function PrecisionFolderIcon({
  isUp,
  isSymlink,
  className = 'h-4 w-4',
}: {
  isUp?: boolean
  isSymlink?: boolean
  className?: string
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 精密机甲背板 */}
        <polygon points="3,8 12,8 15,11 29,11 29,26 3,26" fill="#0284C7" fillOpacity="0.2" stroke="#0284C7" strokeWidth="1.3" />
        {/* 前盖板 */}
        <polygon points="3,13 29,13 29,26 3,26" fill="#38BDF8" fillOpacity="0.15" stroke="#38BDF8" strokeWidth="1.4" />
        {/* 顶部激光刻线 */}
        <line x1="5" y1="15" x2="27" y2="15" stroke="#38BDF8" strokeWidth="0.8" opacity="0.6" strokeDasharray="2 1" />
        {/* 工业精密几何插槽 */}
        {isUp ? (
          <path d="M16 15 V22 M13 18 L16 15 L19 18" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="square" fill="none" />
        ) : (
          <g stroke="#38BDF8" strokeWidth="1.2" fill="none">
            <line x1="12" y1="20" x2="20" y2="20" />
            <circle cx="16" cy="20" r="1.5" fill="#38BDF8" />
          </g>
        )}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * 精密科技微透线框卡片 (Precision HUD Wireframe Card)
 * 核心特征：1.4px 精密外框 + 15% 科技微透填充 + 激光高亮刻字
 */
function PrecisionWireframeDoc({
  color,
  letter,
  letterAlign = 'center',
  details,
  size = 'h-4 w-4',
  isSymlink,
}: {
  color: string
  letter?: string
  letterAlign?: 'center' | 'left'
  details?: ReactNode
  size?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 科技倒角线框底板 + 微发光半透明填充 */}
        <polygon points="5,3 20,3 27,10 27,29 5,29" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.4" strokeLinejoin="miter" />
        {/* 45° 倒角切块折线 */}
        <polyline points="20,3 20,10 27,10" stroke={color} strokeWidth="1.4" fill={color} fillOpacity="0.25" />
        {/* 顶部科技芯片刻线 */}
        <line x1="7" y1="6" x2="17" y2="6" stroke={color} strokeWidth="0.8" opacity="0.5" strokeDasharray="1.5 1" />
        {letter && (
          <text
            x={letterAlign === 'left' ? '11.5' : '16'}
            y="21"
            textAnchor="middle"
            fill={color}
            fontSize={letter.length > 2 ? '8' : '10'}
            fontWeight="900"
            fontFamily="monospace, sans-serif"
          >
            {letter}
          </text>
        )}
        {details}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * 精密科技独立芯片徽标 (Precision Tech Chip)
 */
function PrecisionTechChip({
  color,
  children,
  size = 'h-4 w-4',
  isSymlink,
}: {
  color: string
  children: ReactNode
  size?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect x="3.5" y="3.5" width="25" height="25" rx="3" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.4" />
        {/* 四角芯片刻度点 */}
        <circle cx="6" cy="6" r="0.8" fill={color} opacity="0.7" />
        <circle cx="26" cy="6" r="0.8" fill={color} opacity="0.7" />
        <circle cx="6" cy="26" r="0.8" fill={color} opacity="0.7" />
        <circle cx="26" cy="26" r="0.8" fill={color} opacity="0.7" />
        {children}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * Precision 图标主派发逻辑 (工业科技、微透发光线框、激光刻蚀美学)
 */
export function getPrecisionFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  const name = file.name || ''
  const lower = name.toLowerCase()
  const ext = getFileExtension(name)

  // 1. Vue (.vue) - 精密八边形能量框 + 激光双倒角 V
  if (ext === 'vue') {
    return (
      <PrecisionTechChip color="#10B981" size={size} isSymlink={file.isSymlink}>
        <polygon points="6,8 26,8 16,24" stroke="#10B981" strokeWidth="1.8" fill="#10B981" fillOpacity="0.25" strokeLinejoin="miter" />
        <polygon points="10,8 22,8 16,17" stroke="#059669" strokeWidth="1.4" fill="none" strokeLinejoin="miter" />
      </PrecisionTechChip>
    )
  }

  // 2. TypeScript (.ts, .tsx, tsconfig) - 科技蓝芯片框 + 激光 TS
  if (ext === 'ts' || ext === 'tsx' || lower.includes('tsconfig')) {
    const isReact = ext === 'tsx'
    return (
      <PrecisionTechChip color="#2563EB" size={size} isSymlink={file.isSymlink}>
        <text x="16" y="20.5" textAnchor="middle" fill="#2563EB" fontSize={isReact ? '9.5' : '12'} fontWeight="900" fontFamily="monospace">
          {isReact ? 'TSX' : 'TS'}
        </text>
      </PrecisionTechChip>
    )
  }

  // 3. JavaScript (.js, .jsx) - 工业金黄芯片框 + 激光 JS
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const isReact = ext === 'jsx'
    return (
      <PrecisionTechChip color="#D97706" size={size} isSymlink={file.isSymlink}>
        <text x="16" y="20.5" textAnchor="middle" fill="#D97706" fontSize={isReact ? '9.5' : '12'} fontWeight="900" fontFamily="monospace">
          {isReact ? 'JSX' : 'JS'}
        </text>
      </PrecisionTechChip>
    )
  }

  // 4. HTML (.html) - 精密八边形能量盾牌
  if (['html', 'htm'].includes(ext)) {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
        <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
          <polygon points="6,3 26,3 29,8 25,27 16,30 7,27 3,8" fill="#EA580C" fillOpacity="0.12" stroke="#EA580C" strokeWidth="1.4" />
          <text x="16" y="21" textAnchor="middle" fill="#EA580C" fontSize="13" fontWeight="900" fontFamily="sans-serif">5</text>
        </svg>
        {file.isSymlink && <SymlinkBadge />}
      </span>
    )
  }

  // 5. CSS (.css, .scss, .less)
  if (['css', 'less'].includes(ext)) {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
        <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
          <polygon points="6,3 26,3 29,8 25,27 16,30 7,27 3,8" fill="#0284C7" fillOpacity="0.12" stroke="#0284C7" strokeWidth="1.4" />
          <text x="16" y="21" textAnchor="middle" fill="#0284C7" fontSize="13" fontWeight="900" fontFamily="sans-serif">3</text>
        </svg>
        {file.isSymlink && <SymlinkBadge />}
      </span>
    )
  }
  if (['scss', 'sass'].includes(ext)) {
    return (
      <PrecisionTechChip color="#CF649A" size={size} isSymlink={file.isSymlink}>
        <text x="16" y="19.5" textAnchor="middle" fill="#CF649A" fontSize="8" fontWeight="bold" fontFamily="monospace">SASS</text>
      </PrecisionTechChip>
    )
  }

  // 6. Markdown (.md, .markdown)
  if (['md', 'markdown'].includes(ext)) {
    return (
      <PrecisionTechChip color="#0369A1" size={size} isSymlink={file.isSymlink}>
        <path d="M7 19.5 V12 L11 16 L15 12 V19.5" stroke="#0369A1" strokeWidth="2" strokeLinecap="square" fill="none" />
        <path d="M21 12 V19.5 M18.5 17 L21 19.5 L23.5 17" stroke="#0369A1" strokeWidth="2" strokeLinecap="square" fill="none" />
      </PrecisionTechChip>
    )
  }

  // 7. Python (.py, .ipynb)
  if (['py', 'pyw', 'ipynb'].includes(ext) || lower === 'requirements.txt') {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
        <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
          <rect x="3.5" y="3.5" width="25" height="25" rx="3" fill="#0284C7" fillOpacity="0.08" stroke="#0284C7" strokeWidth="1.4" />
          <path d="M15 6 C10 6 7 8 7 11 V13 H15 V14 H6 C6 17 8 20 13 20" stroke="#0284C7" strokeWidth="1.6" strokeLinecap="square" fill="none" />
          <path d="M17 26 C22 26 25 24 25 21 V19 H17 V18 H26 C26 15 24 12 19 12" stroke="#D97706" strokeWidth="1.6" strokeLinecap="square" fill="none" />
          <circle cx="10" cy="8.5" r="1" fill="#0284C7" />
          <circle cx="22" cy="23.5" r="1" fill="#D97706" />
        </svg>
        {file.isSymlink && <SymlinkBadge />}
      </span>
    )
  }

  // 8. Shell / Bash 脚本 - 赛博暗夜黑视窗 + 激光绿提示符
  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
        <svg viewBox="0 0 32 32" fill="none" className="w-full h-full">
          <rect x="3" y="4" width="26" height="24" rx="2" fill="#0F172A" stroke="#334155" strokeWidth="1.2" />
          <line x1="3" y1="10" x2="29" y2="10" stroke="#334155" strokeWidth="1" />
          <circle cx="6" cy="7" r="1" fill="#EF4444" />
          <circle cx="9" cy="7" r="1" fill="#F59E0B" />
          <circle cx="12" cy="7" r="1" fill="#10B981" />
          <path d="M7 16 L11.5 19.5 L7 23" stroke="#22C55E" strokeWidth="2" strokeLinecap="square" fill="none" />
          <line x1="14" y1="23" x2="21" y2="23" stroke="#22C55E" strokeWidth="2" strokeLinecap="square" />
        </svg>
        {file.isSymlink && <SymlinkBadge />}
      </span>
    )
  }

  // 9. JSON (.json)
  if (['json', 'json5', 'jsonc'].includes(ext) || lower === 'package.json') {
    return (
      <PrecisionTechChip color="#D97706" size={size} isSymlink={file.isSymlink}>
        <text x="16" y="21" textAnchor="middle" fill="#D97706" fontSize="14" fontWeight="bold" fontFamily="monospace">{'{ }'}</text>
      </PrecisionTechChip>
    )
  }

  // 10. 系统与应用通用配置 (.conf, .cfg, .config, .ini, .cnf, .properties) -> 精密激光科技齿轮
  if (['conf', 'cfg', 'config', 'ini', 'cnf', 'properties'].includes(ext)) {
    return (
      <PrecisionTechChip color="#38BDF8" size={size} isSymlink={file.isSymlink}>
        <circle cx="16" cy="16" r="7.5" stroke="#38BDF8" strokeWidth="2.2" strokeDasharray="3 1.8" fill="none" />
        <circle cx="16" cy="16" r="4.5" fill="#38BDF8" fillOpacity="0.3" stroke="#38BDF8" strokeWidth="1.2" />
        <circle cx="16" cy="16" r="2" fill="#38BDF8" />
      </PrecisionTechChip>
    )
  }

  // 11. 依赖锁文件与证书密钥
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
      <PrecisionTechChip color="#D97706" size={size} isSymlink={file.isSymlink}>
        <rect x="9" y="13" width="14" height="11" rx="1" fill="#D97706" fillOpacity="0.2" stroke="#D97706" strokeWidth="1.5" />
        <path d="M12 13 V9.5 A4 4 0 0 1 20 9.5 V13" stroke="#D97706" strokeWidth="1.8" fill="none" />
        <circle cx="16" cy="18" r="1.5" fill="#D97706" />
      </PrecisionTechChip>
    )
  }

  // ==========================================
  // Office 与核心文档 (PrecisionWireframeDoc 微透机甲线框卡片)
  // ==========================================

  // 12. Word 文档 (.docx, .doc, .rtf) -> 科技蓝机甲线框 + 激光大 W
  if (['doc', 'docx', 'rtf', 'odt', 'wps'].includes(ext)) {
    return (
      <PrecisionWireframeDoc
        size={size}
        isSymlink={file.isSymlink}
        color="#0284C7"
        letter="W"
        letterAlign="left"
        details={
          <g stroke="#0284C7" strokeWidth="1.4" strokeLinecap="square" opacity="0.7">
            <line x1="17" y1="14" x2="23" y2="14" />
            <line x1="17" y1="18.5" x2="23" y2="18.5" />
            <line x1="17" y1="23" x2="21" y2="23" />
          </g>
        }
      />
    )
  }

  // 13. Excel 表格 (.xlsx, .xls, .csv) -> 工业绿机甲线框 + 激光大 X
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'et'].includes(ext)) {
    return (
      <PrecisionWireframeDoc
        size={size}
        isSymlink={file.isSymlink}
        color="#059669"
        letter="X"
        letterAlign="left"
        details={
          <g stroke="#059669" strokeWidth="1.2" strokeLinecap="square" opacity="0.7">
            <line x1="17" y1="13" x2="24" y2="13" />
            <line x1="17" y1="17" x2="24" y2="17" />
            <line x1="17" y1="21" x2="24" y2="21" />
            <line x1="20.5" y1="11" x2="20.5" y2="23" />
          </g>
        }
      />
    )
  }

  // 14. PowerPoint 演示 (.pptx, .ppt) -> 暖橙金机甲线框 + 激光大 P
  if (['ppt', 'pptx', 'odp', 'dps'].includes(ext)) {
    return (
      <PrecisionWireframeDoc
        size={size}
        isSymlink={file.isSymlink}
        color="#D97706"
        letter="P"
        letterAlign="left"
        details={
          <g opacity="0.7">
            <circle cx="20.5" cy="18" r="3" stroke="#D97706" strokeWidth="1.2" fill="none" />
            <path d="M20.5 15 V18 H23.5" fill="#D97706" />
          </g>
        }
      />
    )
  }

  // 15. PDF 文档 (.pdf) -> 警示红机甲线框 + 激光居中刻字 PDF
  if (ext === 'pdf') {
    return (
      <PrecisionWireframeDoc
        size={size}
        isSymlink={file.isSymlink}
        color="#DC2626"
        letter="PDF"
        letterAlign="center"
        details={
          <line x1="10" y1="24.5" x2="22" y2="24.5" stroke="#DC2626" strokeWidth="1.4" opacity="0.8" />
        }
      />
    )
  }

  // 15. 纯文本与系统日志 (.txt, .log) -> 冷钢灰机甲线框 + 平行刻线
  if (['txt', 'log', 'text', 'out', 'err', 'diff', 'patch'].includes(ext)) {
    return (
      <PrecisionWireframeDoc
        size={size}
        isSymlink={file.isSymlink}
        color="#64748B"
        letter=""
        details={
          <g stroke="#64748B" strokeWidth="1.4" strokeLinecap="square" opacity="0.75">
            <line x1="8" y1="11" x2="16" y2="11" />
            <line x1="8" y1="15.5" x2="24" y2="15.5" />
            <line x1="8" y1="20" x2="24" y2="20" />
            <line x1="8" y1="24.5" x2="17" y2="24.5" />
          </g>
        }
      />
    )
  }

  // 16. 归档与压缩包 (.zip, .tar, .gz, .7z)
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'].includes(ext)) {
    return (
      <PrecisionTechChip color="#B45309" size={size} isSymlink={file.isSymlink}>
        <line x1="16" y1="5" x2="16" y2="27" stroke="#B45309" strokeWidth="1.8" strokeDasharray="2 1.5" />
        <rect x="13.5" y="13" width="5" height="6" rx="1" fill="#B45309" fillOpacity="0.3" stroke="#B45309" strokeWidth="1.2" />
        <circle cx="16" cy="16" r="0.8" fill="#B45309" />
      </PrecisionTechChip>
    )
  }

  // 17. 图片文件
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp'].includes(ext)) {
    return (
      <PrecisionTechChip color="#DB2777" size={size} isSymlink={file.isSymlink}>
        <circle cx="10" cy="11" r="2" stroke="#DB2777" strokeWidth="1.2" />
        <polygon points="7,23 13,15 18,20 22,14 25,23" stroke="#DB2777" strokeWidth="1.4" strokeLinejoin="miter" fill="#DB2777" fillOpacity="0.2" />
      </PrecisionTechChip>
    )
  }

  // 18. 视频文件
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) {
    return (
      <PrecisionTechChip color="#7C3AED" size={size} isSymlink={file.isSymlink}>
        <polygon points="13,11 22,16 13,21" fill="#7C3AED" />
      </PrecisionTechChip>
    )
  }

  // 19. 音频文件
  if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) {
    return (
      <PrecisionTechChip color="#9333EA" size={size} isSymlink={file.isSymlink}>
        <path d="M10 20 A3 2.5 0 1 0 13 17.5 V9 L22 7 V15.5 A3 2.5 0 1 0 25 13 V5 L10 7.5 V20 Z" fill="#9333EA" />
      </PrecisionTechChip>
    )
  }

  // 20. 二进制与可执行文件 (.exe, .msi, .bin, .dll)
  if (['exe', 'msi', 'bin', 'dll', 'so', 'dylib', 'appimage', 'apk', 'deb', 'rpm'].includes(ext)) {
    return (
      <PrecisionTechChip color="#0284C7" size={size} isSymlink={file.isSymlink}>
        <rect x="5" y="6" width="22" height="5" fill="#0284C7" fillOpacity="0.3" />
        <text x="16" y="21" textAnchor="middle" fill="#0284C7" fontSize="9" fontWeight="900" fontFamily="monospace">EXE</text>
      </PrecisionTechChip>
    )
  }

  // 21. 数据库 SQL (.sql, .db, .sqlite)
  if (['sql', 'db', 'sqlite', 'sqlite3', 'dump'].includes(ext)) {
    return (
      <PrecisionTechChip color="#0891B2" size={size} isSymlink={file.isSymlink}>
        <ellipse cx="16" cy="9" rx="8" ry="3" stroke="#0891B2" strokeWidth="1.4" fill="#0891B2" fillOpacity="0.2" />
        <path d="M8 9 V15 C8 16.5 11.5 18 16 18 C20.5 18 24 16.5 24 15 V9" stroke="#0891B2" strokeWidth="1.4" fill="none" />
        <path d="M8 15 V21 C8 22.5 11.5 24 16 24 C20.5 24 24 22.5 24 21 V15" stroke="#0891B2" strokeWidth="1.4" fill="none" />
      </PrecisionTechChip>
    )
  }

  // 22. 通用其它代码
  const OTHER_CODE_EXT = new Set(['go', 'rs', 'c', 'cpp', 'java', 'kt', 'swift', 'rb', 'php', 'lua'])
  if (OTHER_CODE_EXT.has(ext)) {
    return (
      <PrecisionTechChip color="#047857" size={size} isSymlink={file.isSymlink}>
        <path d="M10 12 L6 16 L10 20 M22 12 L26 16 L22 20 M18 10 L14 22" stroke="#047857" strokeWidth="2" strokeLinecap="square" fill="none" />
      </PrecisionTechChip>
    )
  }

  // 23. 未知或普通文件
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <polygon points="5,3 20,3 27,10 27,29 5,29" fill="#64748B" fillOpacity="0.06" stroke="#94A3B8" strokeWidth="1.2" />
        <polygon points="20,3 20,10 27,10" fill="#94A3B8" fillOpacity="0.2" stroke="#94A3B8" strokeWidth="1.2" />
        <line x1="9" y1="15" x2="23" y2="15" stroke="#94A3B8" strokeWidth="1" strokeDasharray="1.5 1.5" />
        <line x1="9" y1="19" x2="19" y2="19" stroke="#94A3B8" strokeWidth="1" strokeDasharray="1.5 1.5" />
      </svg>
      {file.isSymlink && <SymlinkBadge />}
    </span>
  )
}

export const precisionTheme: FileIconTheme = {
  id: 'precision',
  nameKey: 'sftp_icon_theme_precision',
  descKey: 'sftp_icon_theme_precision_desc',
  renderPreviewFolder: (size = 'h-6 w-6') => <PrecisionFolderIcon className={size} />,
  renderPreviewFile: (size = 'h-6 w-6') => getPrecisionFileIcon({ name: 'main.rs', isDirectory: false }, size),
  renderPreviewList: (size = 'h-7 w-7') => [
    <PrecisionFolderIcon key="folder" className={size} />,
    <span key="ts" className="inline-flex">{getPrecisionFileIcon({ name: 'app.ts', isDirectory: false }, size)}</span>,
    <span key="vue" className="inline-flex">{getPrecisionFileIcon({ name: 'App.vue', isDirectory: false }, size)}</span>,
    <span key="word" className="inline-flex">{getPrecisionFileIcon({ name: 'doc.docx', isDirectory: false }, size)}</span>,
    <span key="zip" className="inline-flex">{getPrecisionFileIcon({ name: 'archive.zip', isDirectory: false }, size)}</span>,
  ],
  renderIcon: (file: FileLike, size = 'h-4 w-4'): ReactNode => {
    if (file.isDirectory) {
      return <PrecisionFolderIcon isUp={file.name === '..'} isSymlink={file.isSymlink} className={size} />
    }
    return getPrecisionFileIcon(file, size)
  },
}
