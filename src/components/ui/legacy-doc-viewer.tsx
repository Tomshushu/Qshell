import { useMemo } from 'react'
import { FileText, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface LegacyDocViewerProps {
  data?: Uint8Array | null
  fileName?: string
  className?: string
}

/** 从 Word 97-2003 二进制流中提取 UTF-16LE / ASCII 可读文本段落 */
function extractDocParagraphs(buffer?: Uint8Array | null): string[] {
  if (!buffer || buffer.length === 0) return []

  const paragraphs: string[] = []
  let current = ''

  // 1. 尝试扫描 UTF-16LE（Word 97-2003 主要存储正文格式）
  for (let i = 0; i < buffer.length - 1; i += 2) {
    const code = buffer[i] | (buffer[i + 1] << 8)
    // 允许 ASCII 可打印字符、换行回车制表符、中日韩常用汉字字符区
    const isPrintable =
      (code >= 32 && code <= 126) ||
      code === 10 ||
      code === 13 ||
      code === 9 ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) || // CJK 标点符号
      (code >= 0xff01 && code <= 0xff5e) // 全角字符

    if (isPrintable) {
      if (code === 10 || code === 13) {
        if (current.trim().length >= 2) {
          paragraphs.push(current.trim())
        }
        current = ''
      } else {
        current += String.fromCharCode(code)
      }
    } else {
      if (current.trim().length >= 4) {
        paragraphs.push(current.trim())
      }
      current = ''
    }
  }
  if (current.trim().length >= 2) {
    paragraphs.push(current.trim())
  }

  // 过滤掉二进制头部噪音（如 OLE 属性、字体表名称片段等）
  return paragraphs.filter((p) => {
    // 剔除包含大量乱码或过短的碎片
    if (p.length < 2) return false
    if (p.startsWith('WordDocument') || p.startsWith('CompObj') || p.startsWith('SummaryInformation')) return false
    return true
  })
}

export function LegacyDocViewer({ data, fileName, className }: LegacyDocViewerProps) {
  const paragraphs = useMemo(() => extractDocParagraphs(data), [data])

  return (
    <div className={cn("flex flex-col w-full h-[75vh] overflow-auto bg-muted/30 p-6 select-text", className)}>
      <div className="max-w-3xl mx-auto w-full space-y-4">
        {/* 格式提示卡片 */}
        <div className="flex items-start gap-3 p-3.5 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <div className="font-semibold">旧版 Word 97-2003 (.doc) 正文文本速览</div>
            <div className="text-[11px] leading-relaxed opacity-90">
              此文件为老旧二进制复合文档（.doc）。已为您自动提取正文可读文本段落，避免显示乱码。如需标准页面排版与图片样式，建议将文件另存为现代化的
              <span className="font-semibold font-mono mx-1">.docx</span> 格式。
            </div>
          </div>
        </div>

        {/* 正文渲染容器 */}
        <div className="bg-background rounded-xl border border-border/70 p-6 shadow-xs space-y-3 min-h-[400px]">
          <div className="flex items-center gap-2 pb-3 border-b border-border/50 text-muted-foreground text-xs">
            <FileText className="h-4 w-4 text-blue-500" />
            <span className="font-medium truncate">{fileName || '文档正文'}</span>
          </div>

          {paragraphs.length > 0 ? (
            <div className="space-y-2 text-sm leading-relaxed text-foreground">
              {paragraphs.map((p, idx) => (
                <p key={idx} className="indent-4 break-words">
                  {p}
                </p>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-muted-foreground">
              未能在此 .doc 二进制文件中提取到有效文本段落
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
