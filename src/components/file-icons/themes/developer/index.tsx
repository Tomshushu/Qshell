/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react'
import type { FileIconTheme, FileLike } from '../../types'

function getFileExtension(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx + 1).toLowerCase()
}

/**
 * 识别特殊开发目录徽标
 */
function getDeveloperFolderType(name: string): string | null {
  if (name === '..') return 'up'
  const lower = name.toLowerCase()
  if (lower === '.git' || lower === '.github' || lower === '.gitlab') return 'git'
  if (lower === 'node_modules') return 'node'
  if (['src', 'source', 'sources'].includes(lower)) return 'src'
  if (['dist', 'build', 'out', 'target', 'bin'].includes(lower)) return 'dist'
  if (['test', 'tests', '__tests__', 'spec', 'specs'].includes(lower)) return 'test'
  if (['docs', 'doc', 'documentation'].includes(lower)) return 'docs'
  if (['config', '.config', 'configs', 'settings'].includes(lower)) return 'config'
  if (['public', 'static', 'assets'].includes(lower)) return 'public'
  if (['docker', '.docker'].includes(lower)) return 'docker'
  if (['k8s', 'kubernetes', 'helm'].includes(lower)) return 'k8s'
  return null
}

/**
 * Developer 风格文件夹 SVG
 */
function DeveloperFolderIcon({
  folderType,
  isSymlink,
  className = 'h-4 w-4',
}: {
  folderType?: string | null
  isSymlink?: boolean
  className?: string
}) {
  let emblem: ReactNode = null

  if (folderType === 'up') {
    emblem = (
      <path
        d="M16 11 L16 19 M12 14 L16 11 L20 14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="text-white drop-shadow-sm"
      />
    )
  } else if (folderType === 'git') {
    emblem = (
      <g className="text-orange-400" fill="currentColor">
        <circle cx="13" cy="14" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
        <circle cx="19" cy="17" r="1.5" />
        <path d="M13 14 H16 V12 H19 M16 14 V17 H19" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </g>
    )
  } else if (folderType === 'node') {
    emblem = (
      <path
        d="M16 11 L20.5 13.5 V18.5 L16 21 L11.5 18.5 V13.5 Z"
        stroke="#68A063"
        strokeWidth="1.2"
        fill="#68A063"
        fillOpacity="0.25"
      />
    )
  } else if (folderType === 'src') {
    emblem = (
      <path
        d="M13.5 13 L11.5 15 L13.5 17 M18.5 13 L20.5 15 L18.5 17"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    )
  } else if (folderType === 'test') {
    emblem = (
      <path
        d="M14 11 H18 M15 11 V14 L12 19 H20 L17 14 V11"
        stroke="#38BDF8"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    )
  }

  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 后背衬纸 */}
        <path
          d="M4 8.5 C4 7.4 4.8 6.5 6 6.5 H12.5 C13.5 6.5 14.4 7.1 14.8 8 L16.2 10.2 C16.5 10.6 17 10.8 17.5 10.8 H26 C27.1 10.8 28 11.7 28 12.8 V16 H4 Z"
          fill="#0284C7"
          opacity="0.75"
        />
        {/* 前盖板 */}
        <path
          d="M3.5 13.5 C3.5 12.4 4.4 11.5 5.5 11.5 H26.5 C27.6 11.5 28.5 12.4 28.5 13.5 V24 C28.5 25.1 27.6 26 26.5 26 H5.5 C4.4 26 3.5 25.1 3.5 24 Z"
          fill="#38BDF8"
        />
        {/* 顶部高光细线 */}
        <path d="M4.5 12.5 H27.5" stroke="#BAE6FD" strokeWidth="0.8" opacity="0.8" />
        {emblem}
      </svg>
      {/* 软链接标记 */}
      {isSymlink && (
        <span className="absolute -bottom-0.5 -right-0.5 bg-blue-600 text-white rounded-full p-[1px] shadow-sm ring-1 ring-background">
          <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2 L13 2 L13 7 M12.5 2.5 L6 9 M4 4 H3 C2 4 1 5 1 6 V12 C1 13 2 14 3 14 H9 C10 14 11 13 11 12 V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      )}
    </span>
  )
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
 * 实心高辨识度文档大色块卡片 (针对 Word, Excel, PPT, PDF, Text)
 * 对标 Windows / 现代办公桌面系统：高饱和度主品牌色彩大卡片 + 粗白字母与专属纹理，秒级识别
 */
function SolidDocPaper({
  baseColor,
  foldDarkColor,
  letter,
  letterAlign = 'center',
  details,
  className = 'h-4 w-4',
  isSymlink,
}: {
  baseColor: string
  foldDarkColor: string
  letter: string
  letterAlign?: 'center' | 'left'
  details?: ReactNode
  className?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 微弱柔和阴影 */}
        <path
          d="M6 4 C6 2.9 6.9 2 8 2 H20 L26 8 V28 C26 29.1 25.1 30 24 30 H8 C6.9 30 6 29.1 6 28 Z"
          fill="black"
          fillOpacity="0.12"
          transform="translate(0.5, 0.8)"
        />
        {/* 实色饱满卡片底板 */}
        <path
          d="M6 4 C6 2.9 6.9 2 8 2 H20 L26 8 V28 C26 29.1 25.1 30 24 30 H8 C6.9 30 6 29.1 6 28 Z"
          fill={baseColor}
        />
        {/* 顶部折角 */}
        <path
          d="M20 2 V7.5 C20 8.3 20.7 9 21.5 9 H26 Z"
          fill={foldDarkColor}
        />
        {/* 核心字母徽标与排版细节 */}
        {letter && (
          <text
            x={letterAlign === 'left' ? '11.5' : '16'}
            y="20.5"
            textAnchor="middle"
            fill="white"
            fontSize={letter.length > 2 ? '8.5' : '10'}
            fontWeight="900"
            fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
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
 * 通用无多余底板纯粹矢量徽标容器 (Glyph-First)
 * 对标 VS Code Material Icon Theme：大面积纯净符号直出，消除白框干扰
 */
function DirectGlyphIcon({
  children,
  className = 'h-4 w-4',
  isSymlink,
}: {
  children: ReactNode
  className?: string
  isSymlink?: boolean
}) {
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${className}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {children}
      </svg>
      {isSymlink && <SymlinkBadge />}
    </span>
  )
}

/**
 * 匹配各类开发者语言与工具图标
 */
export function getDeveloperFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  const name = file.name || ''
  const lower = name.toLowerCase()
  const ext = getFileExtension(name)

  // 1. Dockerfile / compose
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.') || lower.includes('docker-compose') || lower === '.dockerignore') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="7" y="10" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <rect x="11.2" y="10" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <rect x="15.4" y="10" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <rect x="11.2" y="6" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <rect x="15.4" y="6" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <rect x="19.6" y="10" width="3.2" height="3.2" fill="#0284C7" rx="0.4" />
        <path
          d="M27.5 15 C27.2 15 26.5 15.2 26 15.6 C25.2 14.6 24 14 22 14 H4.5 C4 18.5 6 25 16.5 25 C24.5 25 27 20 28 18.5 C29 18.5 29.5 17.5 29.5 17.5 C29.5 17.5 28.5 17 27.5 17.2 V15 Z"
          fill="#0284C7"
        />
        <circle cx="8.5" cy="18.5" r="0.9" fill="white" />
      </DirectGlyphIcon>
    )
  }

  // 2. Kubernetes / Helm
  if (lower.endsWith('.k8s.yaml') || lower.endsWith('.k8s.yml') || lower.includes('helm') || lower === 'chart.yaml') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <circle cx="16" cy="16" r="13" fill="#326CE5" />
        <circle cx="16" cy="16" r="4" fill="white" />
        <circle cx="16" cy="16" r="2.2" fill="#326CE5" />
        <path
          d="M16 3 V8.5 M16 23.5 V29 M3 16 H8.5 M23.5 16 H29 M6.8 6.8 L10.8 10.8 M21.2 21.2 L25.2 25.2 M6.8 25.2 L10.8 21.2 M21.2 10.8 L25.2 6.8"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </DirectGlyphIcon>
    )
  }

  // 3. Git 特殊文件 (.gitignore, .gitattributes, .gitmodules)
  if (lower.startsWith('.git') || ext === 'git') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#F05032" />
        {/* 经典的 Git 分叉节点网络 */}
        <g stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <circle cx="10" cy="12" r="2.4" fill="white" stroke="none" />
          <circle cx="22" cy="10" r="2.4" fill="white" stroke="none" />
          <circle cx="22" cy="22" r="2.4" fill="white" stroke="none" />
          <path d="M10 12 C10 17 14 22 22 22 M22 10 V22" />
        </g>
      </DirectGlyphIcon>
    )
  }

  // 4. Vue (.vue) - VS Code 标志性翡翠绿双 V 标，绝无白纸底板干扰
  if (ext === 'vue') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <polygon points="3,6 29,6 16,28" fill="#42B883" />
        <polygon points="8.5,6 23.5,6 16,19" fill="#35495E" />
      </DirectGlyphIcon>
    )
  }

  // 5. TypeScript (.ts, .tsx, tsconfig) - 饱满微软 TS 蓝方块
  if (ext === 'ts' || ext === 'tsx' || lower.includes('tsconfig')) {
    const isReact = ext === 'tsx'
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#3178C6" />
        <text
          x="16"
          y="20.5"
          textAnchor="middle"
          fill="white"
          fontSize={isReact ? '10' : '13'}
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="-0.5"
        >
          {isReact ? 'TSX' : 'TS'}
        </text>
      </DirectGlyphIcon>
    )
  }

  // 6. JavaScript (.js, .jsx, .mjs, .cjs) - 官方亮黄黑字方块
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    const isReact = ext === 'jsx'
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#F7DF1E" />
        <text
          x="16"
          y="20.5"
          textAnchor="middle"
          fill="#000000"
          fontSize={isReact ? '10' : '13'}
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="-0.5"
        >
          {isReact ? 'JSX' : 'JS'}
        </text>
      </DirectGlyphIcon>
    )
  }

  // 7. HTML (.html, .htm) - 官方大橙盾牌
  if (['html', 'htm'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <polygon points="4,3 28,3 25.5,27 16,30 6.5,27" fill="#E44D26" />
        <polygon points="16,5 16,28 23.5,25.5 25.5,5" fill="#F16529" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="white"
          fontSize="14"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          5
        </text>
      </DirectGlyphIcon>
    )
  }

  // 8. CSS (.css) - 官方深蓝大盾牌
  if (ext === 'css') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <polygon points="4,3 28,3 25.5,27 16,30 6.5,27" fill="#1572B6" />
        <polygon points="16,5 16,28 23.5,25.5 25.5,5" fill="#33A9DC" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="white"
          fontSize="14"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          3
        </text>
      </DirectGlyphIcon>
    )
  }

  // 9. SCSS / Sass / LESS
  if (['scss', 'sass'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#CF649A" />
        <text
          x="16"
          y="19.5"
          textAnchor="middle"
          fill="white"
          fontSize="8.5"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          Sass
        </text>
      </DirectGlyphIcon>
    )
  }
  if (ext === 'less') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#1D365D" />
        <text
          x="16"
          y="19.5"
          textAnchor="middle"
          fill="white"
          fontSize="8.5"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          less
        </text>
      </DirectGlyphIcon>
    )
  }

  // 10. Markdown (.md, .markdown) - 经典蓝方块 + 纯白 M 字母与粗下箭头
  if (['md', 'markdown'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="5" width="26" height="22" rx="4" fill="#083344" stroke="#0284C7" strokeWidth="1.2" />
        {/* M 字母 */}
        <path
          d="M7 19.5 V12.5 L10.5 16 L14 12.5 V19.5"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* 向下粗箭头 */}
        <path
          d="M21 12.5 V19.5 M18.5 17 L21 19.5 L23.5 17"
          stroke="#38BDF8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </DirectGlyphIcon>
    )
  }

  // 11. JSON (.json, .json5, .jsonc, package.json)
  if (['json', 'json5', 'jsonc'].includes(ext) || lower === 'package.json') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="1.5" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="#D97706"
          fontSize="14"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {'{ }'}
        </text>
      </DirectGlyphIcon>
    )
  }

  // 12. Python (.py, .pyw, .ipynb, requirements.txt) - 经典高辨识度黄蓝双蛇
  if (['py', 'pyw', 'ipynb'].includes(ext) || lower === 'requirements.txt' || lower === 'pipfile') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        {/* 上方蓝色小蛇 */}
        <path
          d="M15.5 3 C9 3 6 5.5 6 9 V13 H16 V14.5 H4 C4 18.5 7.5 22.5 14 22.5 H16 V19 C16 16.5 18 14.5 20.5 14.5 H24 C26.5 14.5 28 12.5 28 10 V9 C28 5.5 24 3 18.5 3 H15.5 Z"
          fill="#3B82F6"
        />
        <circle cx="10.5" cy="7" r="1.5" fill="white" />
        {/* 下方黄色小蛇 */}
        <path
          d="M16.5 29 C23 29 26 26.5 26 23 V19 H16 V17.5 H28 C28 13.5 24.5 9.5 18 9.5 H16 V13 C16 15.5 14 17.5 11.5 17.5 H8 C5.5 17.5 4 19.5 4 22 V23 C4 26.5 8 29 13.5 29 H16.5 Z"
          fill="#FACC15"
        />
        <circle cx="21.5" cy="25" r="1.5" fill="#1E293B" />
      </DirectGlyphIcon>
    )
  }

  // 13. Go (.go, go.mod, go.sum)
  if (ext === 'go' || lower === 'go.mod' || lower === 'go.sum') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#00ADD8" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="white"
          fontSize="13"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          letterSpacing="0.5"
        >
          GO
        </text>
      </DirectGlyphIcon>
    )
  }

  // 14. Rust (.rs, Cargo.toml)
  if (ext === 'rs' || lower === 'cargo.toml') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#1C1917" stroke="#EA580C" strokeWidth="1.2" />
        <circle cx="16" cy="16" r="10.5" stroke="#EA580C" strokeWidth="2" strokeDasharray="3.5 2" fill="#292524" />
        <circle cx="16" cy="16" r="5" fill="#EA580C" />
        <text
          x="16"
          y="20"
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontWeight="900"
          fontFamily="monospace"
        >
          R
        </text>
      </DirectGlyphIcon>
    )
  }

  // 15. Java / Kotlin
  if (['java', 'jar', 'class'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#FEF2F2" stroke="#EF4444" strokeWidth="1" />
        {/* 腾腾蒸汽 */}
        <path d="M12 7 C12 7 14 5.5 17 5.5 C20 5.5 21 7 21 7 M11 10 C11 10 13 8.5 16 8.5 C19 8.5 21 10 21 10" stroke="#EA580C" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        {/* 咖啡杯体与把手 */}
        <path d="M9 13 C9 19 13 22 17 22 C21 22 23 19 23 13 H9 Z" fill="#DC2626" />
        <path d="M23 14 C25.5 14 26.5 15.5 26.5 17 C26.5 18.5 25 19.5 23 19.5" stroke="#DC2626" strokeWidth="1.8" fill="none" />
        <line x1="8" y1="24.5" x2="24" y2="24.5" stroke="#EA580C" strokeWidth="2" strokeLinecap="round" />
      </DirectGlyphIcon>
    )
  }
  if (['kt', 'kts'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#1E1B4B" />
        <polygon points="6,6 26,6 16,16 26,26 6,26" fill="#7F52FF" />
      </DirectGlyphIcon>
    )
  }

  // 16. C / C++ (.c, .cpp, .cc, .h, .hpp)
  if (['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'].includes(ext)) {
    const isCpp = ext.includes('p') || ext.includes('x')
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <polygon points="16,3 28,9.5 28,22.5 16,29 4,22.5 4,9.5" fill="#00599C" />
        <text
          x="16"
          y="20"
          textAnchor="middle"
          fill="white"
          fontSize={isCpp ? '9' : '12'}
          fontWeight="bold"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {isCpp ? 'C++' : 'C'}
        </text>
      </DirectGlyphIcon>
    )
  }

  // 17. Shell / Bash / 脚本终端 (.sh, .bash, .zsh, .ps1, .bat, .cmd)
  if (['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        {/* 深墨黑控制台视窗 */}
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#0F172A" stroke="#334155" strokeWidth="1.2" />
        {/* 顶部三点装饰 */}
        <circle cx="7" cy="8" r="1.1" fill="#EF4444" />
        <circle cx="10.5" cy="8" r="1.1" fill="#F59E0B" />
        <circle cx="14" cy="8" r="1.1" fill="#10B981" />
        {/* 荧光绿极醒目命令行 >_ */}
        <path d="M7 14 L11.5 17.5 L7 21" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <line x1="14" y1="21" x2="20" y2="21" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" />
      </DirectGlyphIcon>
    )
  }

  // 18. 数据库 SQL (.sql, .db, .sqlite, .sqlite3)
  if (['sql', 'db', 'sqlite', 'sqlite3', 'dump'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <ellipse cx="16" cy="7" rx="10" ry="3.5" fill="#0891B2" />
        <path d="M6 7 V13 C6 15 10.5 16.5 16 16.5 C21.5 16.5 26 15 26 13 V7" fill="#06B6D4" />
        <path d="M6 13 V19 C6 21 10.5 22.5 16 22.5 C21.5 22.5 26 21 26 19 V13" fill="#0891B2" />
        <path d="M6 19 V25 C6 27 10.5 28.5 16 28.5 C21.5 28.5 26 27 26 25 V19" fill="#0E7490" />
      </DirectGlyphIcon>
    )
  }

  // 19. 依赖锁文件 (package-lock.json, yarn.lock, Cargo.lock, pnpm-lock 等)
  const isLockFile =
    ext === 'lock' ||
    lower === 'package-lock.json' ||
    lower === 'pnpm-lock.yaml' ||
    lower === 'yarn.lock' ||
    lower === 'cargo.lock' ||
    lower === 'composer.lock' ||
    lower === 'gemfile.lock' ||
    lower === 'poetry.lock' ||
    lower === 'mix.lock' ||
    lower === 'flake.lock' ||
    lower === 'pubspec.lock' ||
    lower.endsWith('.lock') ||
    lower.endsWith('-lock.json') ||
    lower.endsWith('-lock.yaml')

  if (isLockFile) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="1.2" />
        <rect x="9" y="13" width="14" height="11" rx="2" fill="#F59E0B" />
        <path d="M12 13 V9.5 A4 4 0 0 1 20 9.5 V13" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <circle cx="16" cy="18" r="1.5" fill="white" />
      </DirectGlyphIcon>
    )
  }

  // 20. 环境变量 (.env, .env.*)
  if (lower.startsWith('.env')) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.5" />
        <text
          x="16"
          y="20.5"
          textAnchor="middle"
          fill="#059669"
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          ENV
        </text>
      </DirectGlyphIcon>
    )
  }

  // 21. 系统与应用通用配置 (.conf, .cfg, .config, .ini, .cnf, .properties) -> 经典高科技深青灰齿轮
  if (['conf', 'cfg', 'config', 'ini', 'cnf', 'properties'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#334155" />
        {/* 精致纯白配置齿轮 */}
        <circle cx="16" cy="16" r="8.5" stroke="white" strokeWidth="2.4" strokeDasharray="3.3 2" fill="none" />
        <circle cx="16" cy="16" r="5.5" fill="white" />
        <circle cx="16" cy="16" r="2.2" fill="#334155" />
      </DirectGlyphIcon>
    )
  }

  // 22. 结构化配置 (YAML / TOML / XML)
  if (['yaml', 'yml'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#DC2626" />
        <text x="16" y="20.5" textAnchor="middle" fill="white" fontSize="9" fontWeight="900" fontFamily="system-ui, sans-serif">
          YML
        </text>
      </DirectGlyphIcon>
    )
  }
  if (ext === 'toml') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#0369A1" />
        <text x="16" y="20" textAnchor="middle" fill="white" fontSize="7.5" fontWeight="900" fontFamily="system-ui, sans-serif">
          TOML
        </text>
      </DirectGlyphIcon>
    )
  }
  if (ext === 'xml') {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#EA580C" />
        <text x="16" y="20.5" textAnchor="middle" fill="white" fontSize="8.5" fontWeight="900" fontFamily="system-ui, sans-serif">
          XML
        </text>
      </DirectGlyphIcon>
    )
  }

  // ==========================================
  // 核心办公文档 (高饱和度实色品牌大卡片 SolidDocPaper)
  // 用户最关切的 Word / Excel / PPT / PDF 饱满秒识别
  // ==========================================

  // 23. Word 文档 (.docx, .doc, .rtf, .odt, .wps) -> 微软深蓝卡片 + 白大 W + 3条排版线
  if (['doc', 'docx', 'rtf', 'odt', 'wps'].includes(ext)) {
    return (
      <SolidDocPaper
        className={size}
        isSymlink={file.isSymlink}
        baseColor="#185ABD"
        foldDarkColor="#0F3B7A"
        letter="W"
        letterAlign="left"
        details={
          <g stroke="white" strokeWidth="1.6" strokeLinecap="round" opacity="0.85">
            <line x1="17.5" y1="13.5" x2="23.5" y2="13.5" />
            <line x1="17.5" y1="18.5" x2="23.5" y2="18.5" />
            <line x1="17.5" y1="23.5" x2="21.5" y2="23.5" />
          </g>
        }
      />
    )
  }

  // 24. Excel 表格 (.xlsx, .xls, .csv, .tsv, .ods, .et) -> 微软深绿卡片 + 白大 X + 表格网格
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods', 'et'].includes(ext)) {
    return (
      <SolidDocPaper
        className={size}
        isSymlink={file.isSymlink}
        baseColor="#107C41"
        foldDarkColor="#0A4C27"
        letter="X"
        letterAlign="left"
        details={
          <g stroke="white" strokeWidth="1.2" strokeLinecap="round" opacity="0.85">
            <line x1="17" y1="13" x2="24" y2="13" />
            <line x1="17" y1="17" x2="24" y2="17" />
            <line x1="17" y1="21" x2="24" y2="21" />
            <line x1="20.5" y1="11" x2="20.5" y2="23" />
          </g>
        }
      />
    )
  }

  // 25. PowerPoint 演示 (.ppt, .pptx, .odp, .dps) -> 微软暖橙红卡片 + 白大 P + 饼图微标
  if (['ppt', 'pptx', 'odp', 'dps'].includes(ext)) {
    return (
      <SolidDocPaper
        className={size}
        isSymlink={file.isSymlink}
        baseColor="#C43E1C"
        foldDarkColor="#7C2611"
        letter="P"
        letterAlign="left"
        details={
          <g opacity="0.85">
            <circle cx="20.5" cy="18" r="3.2" stroke="white" strokeWidth="1.2" fill="none" />
            <path d="M20.5 14.8 V18 H23.7" fill="white" />
          </g>
        }
      />
    )
  }

  // 26. PDF 文档 (.pdf) -> Adobe 猩红卡片 + 绝对正中居中白字 PDF 印章
  if (ext === 'pdf') {
    return (
      <SolidDocPaper
        className={size}
        isSymlink={file.isSymlink}
        baseColor="#DC2626"
        foldDarkColor="#991B1B"
        letter="PDF"
        letterAlign="center"
        details={
          <line x1="10" y1="24" x2="22" y2="24" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.8" />
        }
      />
    )
  }

  // 26. 纯文本与系统日志 (.txt, .log, .text, .out, .diff, .patch) -> 沉稳冷灰卡片 + 层次水平排版线
  if (['txt', 'log', 'text', 'out', 'err', 'diff', 'patch'].includes(ext)) {
    return (
      <SolidDocPaper
        className={size}
        isSymlink={file.isSymlink}
        baseColor="#475569"
        foldDarkColor="#334155"
        letter=""
        details={
          <g stroke="white" strokeWidth="1.8" strokeLinecap="round" opacity="0.85">
            <line x1="9" y1="10" x2="17" y2="10" />
            <line x1="9" y1="14.5" x2="23" y2="14.5" />
            <line x1="9" y1="19" x2="23" y2="19" />
            <line x1="9" y1="23.5" x2="16" y2="23.5" />
          </g>
        }
      />
    )
  }

  // ==========================================
  // 多媒体与归档文件
  // ==========================================

  // 27. 压缩包与归档 (.zip, .tar, .gz, .bz2, .xz, .7z, .rar) -> 金黄色饱满背包 + 金属拉链
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar', 'tgz'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#D97706" />
        <rect x="5" y="6" width="22" height="6" rx="2" fill="#F59E0B" />
        {/* 拉链咬合齿与金属拉环 */}
        <line x1="16" y1="6" x2="16" y2="24" stroke="#78350F" strokeWidth="2.2" strokeDasharray="2 1.5" />
        <rect x="14" y="14" width="4" height="5" rx="1" fill="#FEF3C7" stroke="#78350F" strokeWidth="1" />
        <circle cx="16" cy="16.5" r="0.8" fill="#78350F" />
      </DirectGlyphIcon>
    )
  }

  // 28. 图片文件 (.png, .jpg, .jpeg, .gif, .svg, .webp, .ico, .avif, .bmp) -> 饱满玫瑰粉红画框
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif', 'bmp', 'tiff'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#DB2777" />
        {/* 太阳与双山剪影 */}
        <circle cx="10" cy="11" r="2.5" fill="#FDE047" />
        <path d="M5 25 L12 16 L17 21 L21 15 L27 25 Z" fill="#FCE7F3" />
      </DirectGlyphIcon>
    )
  }

  // 29. 视频文件 (.mp4, .mkv, .avi, .mov, .wmv, .flv, .webm) -> 紫罗兰胶片框 + 播放三角
  if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#7C3AED" />
        {/* 顶部与底部胶卷齿 */}
        <rect x="5" y="6" width="3" height="2.5" fill="#C4B5FD" rx="0.5" />
        <rect x="11" y="6" width="3" height="2.5" fill="#C4B5FD" rx="0.5" />
        <rect x="17" y="6" width="3" height="2.5" fill="#C4B5FD" rx="0.5" />
        <rect x="23" y="6" width="3" height="2.5" fill="#C4B5FD" rx="0.5" />
        {/* 居中白色播放按钮 */}
        <polygon points="13,12 21,16 13,20" fill="white" />
      </DirectGlyphIcon>
    )
  }

  // 30. 音频文件 (.mp3, .wav, .flac, .aac, .ogg) -> 亮紫卡片 + 双连音符
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#9333EA" />
        <path
          d="M10 20 A3 2.5 0 1 0 13 17.5 V9 L22 7 V15.5 A3 2.5 0 1 0 25 13 V5 L10 7.5 V20 Z"
          fill="white"
        />
      </DirectGlyphIcon>
    )
  }

  // 31. 可执行程序与 Windows 二进制 (.exe, .msi, .dll, .bin, .so, .dylib, .appimage, .apk)
  if (['exe', 'msi', 'bin', 'dll', 'so', 'dylib', 'appimage', 'apk', 'deb', 'rpm'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        {/* 科技钢蓝控制台视窗 */}
        <rect x="3" y="4" width="26" height="24" rx="4" fill="#1E293B" stroke="#0284C7" strokeWidth="1.4" />
        <rect x="3" y="4" width="26" height="6" fill="#0284C7" />
        <circle cx="6.5" cy="7" r="1" fill="white" />
        <circle cx="9.5" cy="7" r="1" fill="white" />
        <text
          x="16"
          y="21"
          textAnchor="middle"
          fill="#38BDF8"
          fontSize="9"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
        >
          {ext.toUpperCase().slice(0, 3)}
        </text>
      </DirectGlyphIcon>
    )
  }

  // 32. 证书与安全密钥 (.pem, .key, .crt, .cer, .pub, .p12, .pfx)
  if (['pem', 'key', 'crt', 'cer', 'pub', 'p12', 'pfx', 'der', 'csr', 'ca'].includes(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="5" fill="#FEF3C7" stroke="#D97706" strokeWidth="1.2" />
        <rect x="9" y="13" width="14" height="11" rx="2" fill="#D97706" />
        <path d="M12 13 V9.5 A4 4 0 0 1 20 9.5 V13" stroke="#B45309" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <circle cx="16" cy="18" r="1.5" fill="white" />
      </DirectGlyphIcon>
    )
  }

  // 33. 其它通用编程语言（如 lua, swift, dart, zig, nim, scala 等）
  const OTHER_CODE_EXT = new Set([
    'lua', 'swift', 'dart', 'zig', 'nim', 'scala', 'ex', 'exs', 'erl', 'r', 'jl', 'pl', 'pm', 'tcl', 'cs', 'vb', 'asm', 's', 'proto', 'graphql', 'gql'
  ])
  if (OTHER_CODE_EXT.has(ext)) {
    return (
      <DirectGlyphIcon className={size} isSymlink={file.isSymlink}>
        <rect x="3" y="3" width="26" height="26" rx="4.5" fill="#047857" />
        <path
          d="M10 12 L6 16 L10 20 M22 12 L26 16 L22 20 M18 10 L14 22"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </DirectGlyphIcon>
    )
  }

  // 34. 无扩展名或未知格式普通文件（干净简约中性纸张，杜绝误标为代码尖括号）
  return (
    <span className={`inline-flex items-center justify-center shrink-0 relative ${size}`}>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* 微弱阴影 */}
        <path
          d="M6 4 C6 2.9 6.9 2 8 2 H20 L26 8 V28 C26 29.1 25.1 30 24 30 H8 C6.9 30 6 29.1 6 28 Z"
          fill="black"
          fillOpacity="0.08"
          transform="translate(0.5, 0.8)"
        />
        {/* 浅灰优雅纸张底板 */}
        <path
          d="M6 4 C6 2.9 6.9 2 8 2 H20 L26 8 V28 C26 29.1 25.1 30 24 30 H8 C6.9 30 6 29.1 6 28 Z"
          fill="#F8FAFC"
          stroke="#CBD5E1"
          strokeWidth="1.2"
          className="dark:fill-slate-800 dark:stroke-slate-600"
        />
        {/* 顶部折角 */}
        <path
          d="M20 2 V7.5 C20 8.3 20.7 9 21.5 9 H26 Z"
          fill="#E2E8F0"
          stroke="#CBD5E1"
          strokeWidth="1.2"
          className="dark:fill-slate-700 dark:stroke-slate-600"
        />
        {/* 淡灰文本虚线 */}
        <line x1="10" y1="15" x2="22" y2="15" stroke="#94A3B8" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.5 1.5" opacity="0.6" />
        <line x1="10" y1="19" x2="18" y2="19" stroke="#94A3B8" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1.5 1.5" opacity="0.6" />
      </svg>
      {file.isSymlink && <SymlinkBadge />}
    </span>
  )
}

export const developerTheme: FileIconTheme = {
  id: 'developer',
  nameKey: 'sftp_icon_theme_developer',
  descKey: 'sftp_icon_theme_developer_desc',
  renderPreviewFolder: (size = 'h-6 w-6') => (
    <DeveloperFolderIcon folderType="src" className={size} />
  ),
  renderPreviewFile: (size = 'h-6 w-6') => {
    return getDeveloperFileIcon({ name: 'main.rs', isDirectory: false }, size)
  },
  renderPreviewList: (size = 'h-7 w-7') => [
    <DeveloperFolderIcon key="folder" folderType="src" className={size} />,
    <span key="vue" className="inline-flex">{getDeveloperFileIcon({ name: 'App.vue', isDirectory: false }, size)}</span>,
    <span key="ts" className="inline-flex">{getDeveloperFileIcon({ name: 'main.ts', isDirectory: false }, size)}</span>,
    <span key="word" className="inline-flex">{getDeveloperFileIcon({ name: 'doc.docx', isDirectory: false }, size)}</span>,
    <span key="excel" className="inline-flex">{getDeveloperFileIcon({ name: 'data.xlsx', isDirectory: false }, size)}</span>,
  ],
  renderIcon: (file: FileLike, size = 'h-4 w-4'): ReactNode => {
    if (file.isDirectory) {
      const folderType = getDeveloperFolderType(file.name)
      return <DeveloperFolderIcon folderType={folderType} isSymlink={file.isSymlink} className={size} />
    }
    return getDeveloperFileIcon(file, size)
  },
}
