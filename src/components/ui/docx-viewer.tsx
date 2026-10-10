import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DocxViewerProps {
  data?: Uint8Array | ArrayBuffer | Blob | null
  className?: string
}

export function DocxViewer({ data, className }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendering, setRendering] = useState(true)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (!data || !containerRef.current) return
    let cancelled = false
    setRendering(true)
    setRenderError(null)

    const container = containerRef.current
    container.innerHTML = ''

    import('docx-preview')
      .then(({ renderAsync }) => {
        if (cancelled) return
        return renderAsync(data, container, undefined, {
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          trimXmlDeclaration: true,
        })
      })
      .then(() => {
        if (!cancelled) setRendering(false)
      })
      .catch((err) => {
        if (!cancelled) {
          setRendering(false)
          setRenderError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
    }
  }, [data])

  return (
    <div className={cn("relative w-full h-[75vh] overflow-auto bg-muted/40 p-4", className)}>
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 z-10">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      )}
      {renderError && (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-center text-destructive">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm font-medium">Word 文档解析失败: {renderError}</p>
        </div>
      )}
      <div ref={containerRef} className="docx-preview-root flex flex-col items-center min-w-full" />
    </div>
  )
}
