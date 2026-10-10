import type { SVGProps } from 'react'

/**
 * 创意文件图标体系（精密硬朗几何风）
 * 统一采用 24x24 视口，纯矢量 SVG 实现。
 * 调整圆角为 1.0~1.2px，线条控制在 1.4~1.5px，告别过分圆润/软萌，呈现干净利落的桌面级现代科技质感。
 */

interface FileIconProps extends SVGProps<SVGSVGElement> {
  className?: string
}

/**
 * 压缩包图标 (Archive / ZIP / TAR / 7Z / GZ)
 * 创意核心：硬朗折角包袋 + 垂直咬合拉链齿 (Zipper Teeth) + 精密金属拉滑块 (Zipper Puller)
 */
export function ArchiveFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 折角底板（微圆角 1.2px，利落几何轮廓） */}
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-amber-500/15 dark:fill-amber-400/10 stroke-amber-500 dark:stroke-amber-400"
      />
      {/* 几何折角 */}
      <path
        d="M14.5 2v5.5H20"
        className="stroke-amber-600 dark:stroke-amber-400 fill-amber-500/20"
      />

      {/* 垂直拉链主轴线 */}
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="12.5"
        className="stroke-amber-600 dark:stroke-amber-400"
        strokeWidth="1.2"
        strokeDasharray="0.5 1.5"
      />

      {/* 密致交错咬合拉链齿 */}
      <path
        d="M10.5 3.5h1.5M12 5h1.5M10.5 6.5h1.5M12 8h1.5M10.5 9.5h1.5M12 11h1.5"
        className="stroke-amber-700 dark:stroke-amber-300"
        strokeWidth="1.3"
      />

      {/* 紧凑金属拉链滑块盒 */}
      <rect
        x="10.25"
        y="12"
        width="3.5"
        height="3"
        rx="0.5"
        className="fill-amber-500 dark:fill-amber-400 stroke-amber-600 dark:stroke-amber-300"
        strokeWidth="1.1"
      />

      {/* 悬垂金属拉环 */}
      <path
        d="M11.25 15v3.2a.75.75 0 0 0 1.5 0V15"
        className="fill-amber-600 dark:fill-amber-300 stroke-amber-700 dark:stroke-amber-200"
        strokeWidth="1.1"
      />
      <circle
        cx="12"
        cy="17.2"
        r="0.4"
        className="fill-background stroke-none"
      />

      {/* 底部紧固横标 */}
      <line
        x1="7"
        y1="19"
        x2="9"
        y2="19"
        className="stroke-amber-600/70 dark:stroke-amber-400/60"
        strokeWidth="1.3"
      />
      <line
        x1="15"
        y1="19"
        x2="17"
        y2="19"
        className="stroke-amber-600/70 dark:stroke-amber-400/60"
        strokeWidth="1.3"
      />
    </svg>
  )
}

/**
 * 文件夹图标 (Folder)
 * 双层微立体风琴文件夹：利落标签卡位 + 精密前袋
 */
export function FolderCreativeIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 后背板与顶部标签（硬朗 1.2px 圆角，水平对齐 x=3 到 x=21） */}
      <path
        d="M3 5.2A1.2 1.2 0 0 1 4.2 4h4.3l1.8 2h9.5A1.2 1.2 0 0 1 21 7.2V10H3V5.2z"
        className="fill-blue-500/25 dark:fill-blue-400/20 stroke-blue-500 dark:stroke-blue-400"
      />
      {/* 内部白纸微露出 */}
      <path
        d="M5.5 6.5h13v3.5h-13z"
        className="fill-background/80 dark:fill-card stroke-none opacity-70"
      />
      {/* 前袋方正几何结构（垂直竖直侧边，底部与顶部等宽 18px） */}
      <path
        d="M3 9h18v10.8a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 19.8V9z"
        className="fill-blue-500/35 dark:fill-blue-500/30 stroke-blue-500 dark:stroke-blue-400"
      />
      {/* 结构微线 */}
      <line
        x1="5.5"
        y1="12"
        x2="18.5"
        y2="12"
        className="stroke-blue-400/60 dark:stroke-blue-300/40"
        strokeWidth="1.1"
      />
    </svg>
  )
}

/**
 * 返回上级目录图标 (FolderUp / Parent Directory)
 * 硬朗方正文件夹 + 向上流线跃升微徽标
 */
export function FolderUpCreativeIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 后背板 */}
      <path
        d="M3 5.2A1.2 1.2 0 0 1 4.2 4h4.3l1.8 2h9.5A1.2 1.2 0 0 1 21 7.2V10H3V5.2z"
        className="fill-sky-500/20 dark:fill-sky-400/15 stroke-sky-500 dark:stroke-sky-400"
      />
      {/* 前袋方正几何结构 */}
      <path
        d="M3 9h18v10.8a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 19.8V9z"
        className="fill-sky-500/30 dark:fill-sky-500/25 stroke-sky-500 dark:stroke-sky-400"
      />
      {/* 紧凑徽标卡片 */}
      <rect
        x="8.5"
        y="11.5"
        width="7"
        height="7"
        rx="1"
        className="fill-sky-500 dark:fill-sky-400 stroke-none"
      />
      <path
        d="M12 16.5v-4M10 14l2-2 2 2"
        className="stroke-white dark:stroke-slate-950"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/**
 * 通用代码文件图标 (Code: .c, .cpp, .go, .rs, .java, etc.)
 * 创意核心：折角文档 + 精准 `< / >` 代码角标
 */
export function CodeFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-emerald-500/15 dark:fill-emerald-400/10 stroke-emerald-500 dark:stroke-emerald-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-emerald-600 dark:stroke-emerald-400 fill-emerald-500/20" />

      {/* `< / >` 符号 */}
      <path
        d="m9 12-2.5 2.5L9 17"
        className="stroke-emerald-600 dark:stroke-emerald-300"
        strokeWidth="1.5"
      />
      <path
        d="m15 12 2.5 2.5-2.5 2.5"
        className="stroke-emerald-600 dark:stroke-emerald-300"
        strokeWidth="1.5"
      />
      <line
        x1="13"
        y1="11.5"
        x2="11"
        y2="17.5"
        className="stroke-emerald-500 dark:stroke-emerald-400"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/**
 * Python 代码文件图标 (.py)
 * 创意核心：青蓝与金黄灵动双色微弧
 */
export function PythonFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-sky-500/15 dark:fill-sky-400/10 stroke-sky-500 dark:stroke-sky-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-sky-600 dark:stroke-sky-400 fill-sky-500/20" />

      {/* Python 双色微缩徽标 */}
      <path
        d="M11.5 10.5H14a1.2 1.2 0 0 1 1.2 1.2v1.5h-3a0.8 0.8 0 0 0-.8.8V17"
        className="stroke-sky-500 dark:stroke-sky-400"
        strokeWidth="1.5"
      />
      <circle cx="12.5" cy="11.5" r="0.5" className="fill-sky-500 dark:fill-sky-400 stroke-none" />

      <path
        d="M12.5 18.5H10a1.2 1.2 0 0 1-1.2-1.2v-1.5h3a0.8 0.8 0 0 0 .8-.8V12"
        className="stroke-amber-500 dark:stroke-amber-400"
        strokeWidth="1.5"
      />
      <circle cx="11.5" cy="17.5" r="0.5" className="fill-amber-500 dark:fill-amber-400 stroke-none" />
    </svg>
  )
}

/**
 * JavaScript / TypeScript 代码文件图标 (.js, .ts, .jsx, .tsx)
 * 创意核心：现代大括号 `{ }` 极简符号
 */
export function ScriptCodeFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-yellow-500/15 dark:fill-yellow-400/10 stroke-yellow-500 dark:stroke-yellow-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-yellow-600 dark:stroke-yellow-400 fill-yellow-500/20" />

      {/* 左括号 `{` */}
      <path
        d="M10 11.5c-.8 0-1.2.4-1.2 1.2v.4c0 .6-.4.8-.8.8.4 0 .8.2.8.8v.4c0 .8.4 1.2 1.2 1.2"
        className="stroke-yellow-600 dark:stroke-yellow-300"
        strokeWidth="1.4"
      />
      {/* 右括号 `}` */}
      <path
        d="M14 11.5c.8 0 1.2.4 1.2 1.2v.4c0 .6.4.8.8.8-.4 0-.8.2-.8.8v.4c0 .8-.4 1.2-1.2 1.2"
        className="stroke-yellow-600 dark:stroke-yellow-300"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/**
 * Shell / 终端脚本图标 (.sh, .bash, .zsh, .ps1, .bat)
 * 创意核心：终端高亮提示符 `>_`
 */
export function ShellScriptFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-slate-500/15 dark:fill-slate-400/10 stroke-slate-600 dark:stroke-slate-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-slate-500 fill-slate-400/20" />

      {/* 终端提示符 `>_` */}
      <path
        d="m8 12.5 2.5 2.5L8 17.5"
        className="stroke-emerald-500 dark:stroke-emerald-400"
        strokeWidth="1.7"
      />
      <line
        x1="12.5"
        y1="17.5"
        x2="16"
        y2="17.5"
        className="stroke-emerald-500 dark:stroke-emerald-400"
        strokeWidth="1.7"
      />
    </svg>
  )
}

/**
 * PDF 文件图标 (.pdf)
 * 创意核心：高辨识度猩红折角信笺 + 精密 PDF 印记
 */
export function PdfFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-rose-500/15 dark:fill-rose-400/10 stroke-rose-500 dark:stroke-rose-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-rose-600 dark:stroke-rose-400 fill-rose-500/25" />

      {/* PDF 标牌（直角微圆 0.5px） */}
      <rect
        x="6.5"
        y="12"
        width="11"
        height="6.5"
        rx="0.5"
        className="fill-rose-500 dark:fill-rose-500 stroke-none"
      />
      <path
        d="M8.5 16.5v-3.5h1.2a0.8 0.8 0 0 1 0 1.6H8.5m4-1.6v3.5h.8a1 1 0 0 0 1-1v-1.5a1 1 0 0 0-1-1h-.8m3 0h1.8m-1.8 1.8h1.4m-1.4-1.8v3.5"
        className="stroke-white"
        strokeWidth="1"
      />
    </svg>
  )
}

/**
 * 办公文档图标 (.doc, .docx)
 * 创意核心：皇家蓝折角信笺 + 结构段落线条
 */
export function DocFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-blue-500/15 dark:fill-blue-400/10 stroke-blue-500 dark:stroke-blue-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-blue-600 dark:stroke-blue-400 fill-blue-500/20" />

      {/* 文本段落行 */}
      <line x1="8" y1="12" x2="16" y2="12" className="stroke-blue-500 dark:stroke-blue-300" strokeWidth="1.4" />
      <line x1="8" y1="15" x2="14" y2="15" className="stroke-blue-500 dark:stroke-blue-300" strokeWidth="1.4" />
      <line x1="8" y1="18" x2="12" y2="18" className="stroke-blue-400 dark:stroke-blue-400" strokeWidth="1.4" />
    </svg>
  )
}

/**
 * Markdown 文档图标 (.md)
 * 创意核心：带有 `#` 标题标识与列表微符号
 */
export function MarkdownFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-indigo-500/15 dark:fill-indigo-400/10 stroke-indigo-500 dark:stroke-indigo-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-indigo-600 dark:stroke-indigo-400 fill-indigo-500/20" />

      {/* `#` 标题符号 */}
      <path
        d="M8.5 12.5v5M11 12.5v5M7.5 14h4.5M7.5 16h4.5"
        className="stroke-indigo-600 dark:stroke-indigo-300"
        strokeWidth="1.3"
      />
      {/* 列表指示 */}
      <line x1="14" y1="13.5" x2="16.5" y2="13.5" className="stroke-indigo-400 dark:stroke-indigo-300" strokeWidth="1.3" />
      <line x1="14" y1="16.5" x2="16.5" y2="16.5" className="stroke-indigo-400 dark:stroke-indigo-300" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * 表格文件图标 (.xls, .xlsx, .csv)
 * 创意核心：翡翠绿矩阵网格 (Matrix Sheet)
 */
export function SheetFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-emerald-500/15 dark:fill-emerald-400/10 stroke-emerald-500 dark:stroke-emerald-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-emerald-600 dark:stroke-emerald-400 fill-emerald-500/20" />

      {/* 2x2 网格矩阵（微圆角 0.5px） */}
      <rect
        x="7"
        y="11"
        width="10"
        height="7.5"
        rx="0.5"
        className="stroke-emerald-600 dark:stroke-emerald-300 fill-emerald-500/20"
        strokeWidth="1.3"
      />
      {/* 网格十字分割线 */}
      <line x1="12" y1="11" x2="12" y2="18.5" className="stroke-emerald-600 dark:stroke-emerald-300" strokeWidth="1.2" />
      <line x1="7" y1="14.5" x2="17" y2="14.5" className="stroke-emerald-600 dark:stroke-emerald-300" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * 图像文件图标 (.png, .jpg, .svg, .webp, .gif)
 * 创意核心：利落相框卡片 (微圆角 1.2px) + 几何双峰与日光剪影
 */
export function ImageFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 相框外轮廓（硬朗 1.2px 圆角） */}
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="1.2"
        className="fill-pink-500/15 dark:fill-pink-400/10 stroke-pink-500 dark:stroke-pink-400"
      />
      {/* 日光圆 */}
      <circle
        cx="8.5"
        cy="8.5"
        r="1.6"
        className="fill-pink-500 dark:fill-pink-400 stroke-none"
      />
      {/* 连绵双峰山峦剪影 */}
      <path
        d="m4 16.5 4.5-4.5a1 1 0 0 1 1.4 0l1.8 1.8a1 1 0 0 0 1.4 0l2.4-2.4a1 1 0 0 1 1.4 0l3.1 3.1"
        className="stroke-pink-600 dark:stroke-pink-300"
        strokeWidth="1.4"
      />
    </svg>
  )
}

/**
 * 音频文件图标 (.mp3, .wav, .flac, .aac)
 * 创意核心：折角信笺 + 精准均衡器律动声波柱
 */
export function AudioFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-purple-500/15 dark:fill-purple-400/10 stroke-purple-500 dark:stroke-purple-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-purple-600 dark:stroke-purple-400 fill-purple-500/20" />

      {/* 精准声波柱 */}
      <line x1="7.5" y1="14" x2="7.5" y2="16" className="stroke-purple-500 dark:stroke-purple-300" strokeWidth="1.4" />
      <line x1="10" y1="12" x2="10" y2="18" className="stroke-purple-600 dark:stroke-purple-200" strokeWidth="1.5" />
      <line x1="12.5" y1="10" x2="12.5" y2="20" className="stroke-purple-500 dark:stroke-purple-300" strokeWidth="1.6" />
      <line x1="15" y1="13" x2="15" y2="17" className="stroke-purple-600 dark:stroke-purple-200" strokeWidth="1.5" />
      <line x1="17.2" y1="14" x2="17.2" y2="16" className="stroke-purple-500 dark:stroke-purple-300" strokeWidth="1.4" />
    </svg>
  )
}

/**
 * 视频文件图标 (.mp4, .mkv, .mov, .webm)
 * 创意核心：胶片卡 (微圆角 1.2px) + 播放三角标
 */
export function VideoFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 胶片外框（硬朗 1.2px 圆角） */}
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="1.2"
        className="fill-violet-500/15 dark:fill-violet-400/10 stroke-violet-500 dark:stroke-violet-400"
      />
      {/* 紧凑齿孔 */}
      <circle cx="6" cy="6.8" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />
      <circle cx="12" cy="6.8" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />
      <circle cx="18" cy="6.8" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />
      <circle cx="6" cy="17.2" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />
      <circle cx="12" cy="17.2" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />
      <circle cx="18" cy="17.2" r="0.6" className="fill-violet-500 dark:fill-violet-400 stroke-none" />

      {/* 中央播放三角按钮 */}
      <path
        d="m10.5 9.8 4.5 2.2-4.5 2.2V9.8z"
        className="fill-violet-600 dark:fill-violet-300 stroke-violet-600 dark:stroke-violet-300"
        strokeWidth="1.1"
      />
    </svg>
  )
}

/**
 * 安全密钥与证书图标 (.pem, .key, .crt, .pub, .cer)
 * 创意核心：折角信笺 + 金色安全锁孔印鉴
 */
export function KeyCertFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-amber-500/15 dark:fill-amber-400/10 stroke-amber-500 dark:stroke-amber-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-amber-600 dark:stroke-amber-400 fill-amber-500/20" />

      {/* 锁孔徽标 */}
      <circle
        cx="12"
        cy="13.5"
        r="1.8"
        className="fill-amber-500 dark:fill-amber-400 stroke-amber-600 dark:stroke-amber-300"
        strokeWidth="1.2"
      />
      <path
        d="M12 15.5v3M10.8 17.5h2.4"
        className="stroke-amber-600 dark:stroke-amber-300"
        strokeWidth="1.3"
      />
    </svg>
  )
}

/**
 * 配置文件图标 (.json, .yaml, .yml, .toml, .ini, .conf, .env)
 * 创意核心：折角信笺 + 精密配置齿轮微徽标
 */
export function ConfigFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-cyan-500/15 dark:fill-cyan-400/10 stroke-cyan-500 dark:stroke-cyan-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-cyan-600 dark:stroke-cyan-400 fill-cyan-500/20" />

      {/* 齿轮 */}
      <circle
        cx="12"
        cy="14.5"
        r="1.8"
        className="stroke-cyan-600 dark:stroke-cyan-300"
        strokeWidth="1.3"
      />
      <path
        d="M12 11.2v1M12 16.8v1M8.8 14.5h1M14.2 14.5h1M9.7 12.2l.7.7M13.6 16.1l.7.7M9.7 16.8l.7-.7M13.6 12.9l.7-.7"
        className="stroke-cyan-600 dark:stroke-cyan-300"
        strokeWidth="1.3"
      />
    </svg>
  )
}

/**
 * 数据库数据文件图标 (.sql, .db, .sqlite)
 * 创意核心：折角信笺 + 分层数据圆盘 (Database Disks)
 */
export function DatabaseFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-teal-500/15 dark:fill-teal-400/10 stroke-teal-500 dark:stroke-teal-400"
      />
      <path d="M14.5 2v5.5H20" className="stroke-teal-600 dark:stroke-teal-400 fill-teal-500/20" />

      {/* 数据库圆盘 */}
      <ellipse
        cx="12"
        cy="12"
        rx="4.2"
        ry="1.6"
        className="stroke-teal-600 dark:stroke-teal-300 fill-teal-500/20"
        strokeWidth="1.2"
      />
      <path
        d="M7.8 12v3.5c0 .9 1.9 1.6 4.2 1.6s4.2-.7 4.2-1.6V12"
        className="stroke-teal-600 dark:stroke-teal-300"
        strokeWidth="1.2"
      />
      <path
        d="M7.8 15.5V19c0 .9 1.9 1.6 4.2 1.6s4.2-.7 4.2-1.6v-3.5"
        className="stroke-teal-600 dark:stroke-teal-300"
        strokeWidth="1.2"
      />
    </svg>
  )
}

/**
 * 通用/未知文件图标 (Generic File)
 * 创意核心：微圆角折角信笺 + 利落文本指示条纹
 */
export function GenericFileIcon({ className, ...props }: FileIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      <path
        d="M4 3.2A1.2 1.2 0 0 1 5.2 2H14.5L20 7.5V20.8A1.2 1.2 0 0 1 18.8 22H5.2A1.2 1.2 0 0 1 4 20.8V3.2z"
        className="fill-slate-400/10 dark:fill-slate-500/10 stroke-slate-400 dark:stroke-slate-500"
      />
      <path d="M14.5 2v5.5H20" className="stroke-slate-400 dark:stroke-slate-500 fill-slate-400/20" />
      <line x1="8" y1="13" x2="16" y2="13" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.3" />
      <line x1="8" y1="16.5" x2="13" y2="16.5" className="stroke-slate-300 dark:stroke-slate-600" strokeWidth="1.3" />
    </svg>
  )
}
