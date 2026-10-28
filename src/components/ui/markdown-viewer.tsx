import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { renderMarkdown } from '@/lib/markdown'

interface MarkdownViewerProps {
  content: string
  className?: string
}

export function MarkdownViewer({ content, className }: MarkdownViewerProps) {
  const html = useMemo(() => renderMarkdown(content || ''), [content])

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
