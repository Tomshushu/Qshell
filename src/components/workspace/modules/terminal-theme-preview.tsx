import React from 'react'
import { cn } from '@/lib/utils'
import type { TerminalTheme } from '@/utils/terminal-themes'

interface TerminalPreviewProps {
  theme: TerminalTheme
  /** 预览尺寸:sm=列表缩略图(紧凑), md=中等(下拉项), lg=大(悬停弹窗/详情预览) */
  size?: 'sm' | 'md' | 'lg'
  /** 是否显示主题名称标签(顶部标题栏) */
  showTitle?: boolean
  className?: string
}

/**
 * 终端主题预览组件 —— 模拟真实终端输出,直观展示主题配色效果。
 * 三档尺寸:
 *  - sm: 列表缩略图(h-10),色块占位,无文字细节
 *  - md: 下拉项预览(h-16),含提示符+一行输出
 *  - lg: 完整预览(h-auto),含命令、多行输出、错误/警告/成功色
 */
export function TerminalThemePreview({
  theme,
  size = 'md',
  showTitle = true,
  className = '',
}: TerminalPreviewProps) {
  // 防御性空值保护：若 theme.ui 或 theme.ansi 因数据异常缺失，用安全默认值兜底，
  // 避免渲染时 Cannot read properties of undefined 崩溃。
  const ui = theme.ui ?? {
    background: '#000000',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorForeground: '#000000',
    selection: 'rgba(255,255,255,0.15)',
    selectionForeground: '#ffffff',
    activeBorder: '#38bdf8',
  }
  const ansi = theme.ansi ?? {
    black: '#000000', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e67', brightGreen: '#5af78e',
    brightYellow: '#f4f99d', brightBlue: '#caa9fa', brightMagenta: '#ff92d0',
    brightCyan: '#9aedfe', brightWhite: '#ffffff',
  }
  const bg = ui.background
  const fg = ui.foreground

  // ── sm: 紧凑色块缩略图(列表用) ─────────────────────────────
  if (size === 'sm') {
    return (
      <div
        className={`h-10 w-full rounded border overflow-hidden flex flex-col ${className}`}
        style={{ backgroundColor: bg }}
      >
        {/* 顶栏:三个圆点 + 名称 */}
        {showTitle && (
          <div
            className="h-2.5 flex items-center px-1.5 gap-1 border-b flex-shrink-0"
            style={{ backgroundColor: bg, borderColor: fg + '20' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ansi.red }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ansi.yellow }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ansi.green }} />
            <span
              className="ml-1 text-[7px] font-mono truncate"
              style={{ color: fg, opacity: 0.5 }}
            >
              {theme.name}
            </span>
          </div>
        )}
        {/* 内容区:色块模拟命令行 */}
        <div className="flex-1 px-1.5 py-1 flex flex-col gap-0.5 font-mono text-[7px] leading-none">
          <div className="flex items-center gap-0.5">
            <span style={{ color: ansi.green }}>$</span>
            <span className="inline-block h-1.5 w-3 rounded-sm" style={{ backgroundColor: ansi.blue }} />
            <span className="inline-block h-1.5 w-2 rounded-sm" style={{ backgroundColor: ansi.cyan }} />
          </div>
          <div className="flex items-center gap-0.5">
            <span className="inline-block h-1.5 w-4 rounded-sm" style={{ backgroundColor: ansi.yellow, opacity: 0.7 }} />
            <span className="inline-block h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: ansi.magenta }} />
            <span className="inline-block h-1.5 w-0.5 ml-0.5" style={{ backgroundColor: ui.cursor }} />
          </div>
        </div>
      </div>
    )
  }

  // ── md: 中等预览(下拉项用) ─────────────────────────────────
  if (size === 'md') {
    return (
      <div
        className={`rounded border overflow-hidden font-mono text-[10px] leading-relaxed ${className}`}
        style={{ backgroundColor: bg, color: fg }}
      >
        <div className="p-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-0.5">
            <span style={{ color: ansi.green }}>user@server</span>
            <span style={{ color: ansi.blue }}>:</span>
            <span style={{ color: ansi.cyan }}>~</span>
            <span style={{ color: ansi.blue }}>$</span>
            <span className="inline-block h-2 w-6 rounded-sm" style={{ backgroundColor: ansi.blue }} />
            <span className="inline-block h-2 w-0.5 ml-0.5" style={{ backgroundColor: ui.cursor }} />
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: ansi.red }}>error</span>
            <span style={{ color: ansi.yellow }}>warn</span>
            <span style={{ color: ansi.green }}>ok</span>
          </div>
        </div>
      </div>
    )
  }

  // ── lg: 完整预览(悬停弹窗/详情用) ──────────────────────────
  const activeBorder = ui.activeBorder || (theme.type === 'light' ? '#0284c7' : '#38bdf8')

  return (
    <div
      className={cn('rounded-md border overflow-hidden font-mono text-[11px] leading-relaxed transition-all duration-150', className)}
      style={{
        backgroundColor: bg,
        color: fg,
        boxShadow: `inset 0 0 0 1.5px ${activeBorder}`,
      }}
    >
      <div className="p-2.5 flex flex-col gap-0.5">
        <div>
          <span style={{ color: ansi.green }}>user@server</span>
          <span style={{ color: ansi.blue }}>:</span>
          <span style={{ color: ansi.cyan }}>~</span>
          <span style={{ color: ansi.blue }}>$ ls -la</span>
        </div>
        <div style={{ color: ansi.brightBlack }}>drwxr-xr-x  root root 4096 Oct 12 03:14 apt</div>
        <div style={{ color: ansi.brightBlack }}>-rw-r--r--  root root  1.2K Oct 12 03:14 syslog</div>
        <div>
          <span style={{ color: ansi.red }}>bash: command-not-found</span>
        </div>
        <div>
          <span style={{ color: ansi.yellow }}>Warning: Low disk space</span>
        </div>
        <div>
          <span style={{ color: ansi.green }}>OK: service restarted</span>
        </div>
        <div className="flex items-center gap-1">
          <span style={{ color: ansi.green }}>user@server</span>
          <span style={{ color: ansi.blue }}>:</span>
          <span style={{ color: ansi.cyan }}>~</span>
          <span style={{ color: ansi.blue }}>$ </span>
          <span className="inline-block h-3 w-1.5 align-middle animate-pulse" style={{ backgroundColor: ui.cursor }} />
        </div>
      </div>
    </div>
  )
}
