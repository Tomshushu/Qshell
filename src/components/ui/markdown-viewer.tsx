import { useMemo } from 'react'
import { marked } from 'marked'
import { cn } from '@/lib/utils'

interface MarkdownViewerProps {
  content: string
  className?: string
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  const html = useMemo(() => {
    try {
      return marked.parse(content || '', { gfm: true, breaks: true }) as string
    } catch {
      return content || ''
    }
  }, [content])

  return (
    <div
      className={cn(
        "markdown-preview-body p-6 max-w-4xl mx-auto text-sm leading-relaxed text-foreground select-text",
        className
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
