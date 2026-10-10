import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Search,
  ArrowDown,
  ArrowUp,
  WrapText,
  Copy,
  Check,
  FileText,
  X,
  Braces,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { isLogFileName } from '@/components/workspace/modules/local-file-picker-utils'

export interface LogViewerProps {
  data: string | Uint8Array | ArrayBuffer | Blob | null
  fileName: string
  fileSize?: number
  className?: string
  initialScrollToBottom?: boolean
  hideTitle?: boolean
}

export function LogViewer({
  data,
  fileName,
  fileSize,
  className,
  initialScrollToBottom = true,
  hideTitle = false,
}: LogViewerProps) {
  const isLog = useMemo(() => isLogFileName(fileName), [fileName])
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(true)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isWrapped, setIsWrapped] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)

  const parentRef = useRef<HTMLDivElement>(null)
  const hasAutoScrolledRef = useRef<boolean>(false)

  // 解析不同数据源为完整纯文本
  useEffect(() => {
    let active = true
    setLoading(true)

    const parseData = async () => {
      try {
        if (!data) {
          if (active) setText('')
          return
        }
        if (typeof data === 'string') {
          if (active) setText(data)
          return
        }
        if (data instanceof Blob) {
          const content = await data.text()
          if (active) setText(content)
          return
        }
        if (data instanceof Uint8Array) {
          const content = new TextDecoder('utf-8', { fatal: false }).decode(data)
          if (active) setText(content)
          return
        }
        if (data instanceof ArrayBuffer) {
          const content = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(data))
          if (active) setText(content)
          return
        }
      } catch (err) {
        console.error('Failed to decode log text:', err)
        if (active) setText('解码日志文件失败')
      } finally {
        if (active) setLoading(false)
      }
    }

    void parseData()
    return () => {
      active = false
    }
  }, [data])

  // 按行切分
  const lines = useMemo(() => {
    if (!text) return []
    return text.split(/\r?\n/)
  }, [text])

  // 行号列宽度计算（根据总行数动态计算字符宽度）
  const lineNumWidth = useMemo(() => {
    const digits = Math.max(String(lines.length).length, 3)
    return digits * 8 + 20 // 像素估算
  }, [lines.length])

  // 虚拟化列表
  const rowVirtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 25,
  })

  // 初始自动滚动到末尾（Tail 模式，运维最常关心的最新日志）
  useEffect(() => {
    if (!loading && lines.length > 0 && initialScrollToBottom && !hasAutoScrolledRef.current) {
      hasAutoScrolledRef.current = true
      // 使用 requestAnimationFrame 确保父容器尺寸测量完毕
      requestAnimationFrame(() => {
        if (parentRef.current) {
          parentRef.current.scrollTop = parentRef.current.scrollHeight
        }
      })
    }
  }, [loading, lines.length, initialScrollToBottom])

  // 快捷滚动操作
  const scrollToTop = useCallback(() => {
    if (parentRef.current) {
      rowVirtualizer.scrollToIndex(0, { align: 'start', behavior: 'smooth' })
    }
  }, [rowVirtualizer])

  const scrollToBottom = useCallback(() => {
    if (parentRef.current && lines.length > 0) {
      rowVirtualizer.scrollToIndex(lines.length - 1, { align: 'end', behavior: 'smooth' })
    }
  }, [rowVirtualizer, lines.length])

  // 搜索匹配计算
  const matchIndices = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    const matches: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) {
        matches.push(i)
      }
    }
    return matches
  }, [lines, searchQuery])

  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0)

  useEffect(() => {
    setCurrentMatchIdx(0)
  }, [searchQuery])

  const jumpToMatch = useCallback((direction: 'next' | 'prev') => {
    if (matchIndices.length === 0) return
    const nextIdx = direction === 'next'
      ? (currentMatchIdx + 1) % matchIndices.length
      : (currentMatchIdx - 1 + matchIndices.length) % matchIndices.length
    setCurrentMatchIdx(nextIdx)
    const targetLine = matchIndices[nextIdx]
    rowVirtualizer.scrollToIndex(targetLine, { align: 'center', behavior: 'smooth' })
  }, [matchIndices, currentMatchIdx, rowVirtualizer])

  // 复制全文
  const handleCopyAll = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  // 格式化 / 紧凑 JSON
  const handleToggleFormatJson = useCallback(() => {
    if (!text) return
    try {
      const parsed = JSON.parse(text)
      const isMultiLine = text.includes('\n')
      const formatted = isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)
      setText(formatted)
    } catch (err) {
      console.warn('Invalid JSON:', err)
    }
  }, [text])

  // 大小格式化
  const displaySize = useMemo(() => {
    const bytes = fileSize ?? (text ? new Blob([text]).size : 0)
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }, [fileSize, text])

  return (
    <div className={cn("w-full h-full flex flex-col bg-background text-foreground text-xs font-mono select-text", className)}>
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {!hideTitle && (
            <>
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold text-sm truncate max-w-[200px]" title={fileName}>
                {fileName}
              </span>
              <span className="text-muted-foreground/60 text-xs shrink-0">·</span>
            </>
          )}
          <span className="text-muted-foreground/80 text-[11px] shrink-0 font-mono">
            {lines.length.toLocaleString()} 行 · {displaySize}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium shrink-0">
            虚拟滚动 100% 全量
          </span>
        </div>

        {/* 搜索与快捷工具 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="relative flex items-center">
            <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isLog ? "搜索日志..." : "搜索内容..."}
              className="h-7 w-36 sm:w-48 pl-7 pr-14 text-xs font-mono"
            />
            {searchQuery && (
              <div className="absolute right-1 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                <span className="tabular-nums">
                  {matchIndices.length > 0 ? `${currentMatchIdx + 1}/${matchIndices.length}` : '0'}
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="hover:text-foreground p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {searchQuery && matchIndices.length > 0 && (
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => jumpToMatch('prev')}
                title="上一个匹配 (Shift+F3)"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => jumpToMatch('next')}
                title="下一个匹配 (F3)"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <Button
            variant={isWrapped ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setIsWrapped(!isWrapped)}
            title={isWrapped ? "切换为不自动换行" : "切换为自动换行"}
          >
            <WrapText className="h-3.5 w-3.5 mr-1" />
            {isWrapped ? "换行" : "单行"}
          </Button>

          {(fileName.toLowerCase().endsWith('.json') || (text && (text.trim().startsWith('{') || text.trim().startsWith('[')))) && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleToggleFormatJson}
              title="格式化 JSON (缩进排版 / 紧凑排版)"
            >
              <Braces className="h-3.5 w-3.5 mr-1 text-primary" />
              格式化
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={scrollToTop}
            title={isLog ? "跳转到日志开头" : "跳转到开头"}
          >
            <ArrowUp className="h-3.5 w-3.5 mr-1" />
            顶部
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={scrollToBottom}
            title={isLog ? "跳转到末尾最新日志 (Tail)" : "跳转到末尾"}
          >
            <ArrowDown className="h-3.5 w-3.5 mr-1" />
            末尾
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleCopyAll}
            title={isLog ? "复制完整日志文本" : "复制全文"}
          >
            {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? "已复制" : "复制"}
          </Button>
        </div>
      </div>

      {/* 虚拟滚动渲染区域 */}
      <div
        ref={parentRef}
        className="flex-1 w-full overflow-auto font-mono bg-card/60 relative focus:outline-none"
        tabIndex={0}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {isLog ? '正在加载日志内容...' : '正在加载文件内容...'}
          </div>
        ) : lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            {isLog ? '日志文件为空' : '文件内容为空'}
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const lineText = lines[virtualRow.index]
              const isMatch = searchQuery && lineText.toLowerCase().includes(searchQuery.toLowerCase())
              const isCurrentMatch = searchQuery && matchIndices[currentMatchIdx] === virtualRow.index

              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={cn(
                    "flex items-start w-full hover:bg-muted/50 transition-colors leading-[20px]",
                    isMatch && "bg-amber-500/15 dark:bg-amber-500/20",
                    isCurrentMatch && "bg-amber-500/30 dark:bg-amber-500/35 ring-1 ring-amber-500/50"
                  )}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {/* 行号 */}
                  <div
                    style={{ width: `${lineNumWidth}px` }}
                    className="select-none shrink-0 pr-3 text-right text-muted-foreground/60 tabular-nums border-r border-border/40 font-mono text-[11px]"
                  >
                    {virtualRow.index + 1}
                  </div>

                  {/* 行内容 */}
                  <div
                    className={cn(
                      "flex-1 px-3 py-0 font-mono",
                      isWrapped ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                    )}
                  >
                    {lineText || '\u00A0'}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
