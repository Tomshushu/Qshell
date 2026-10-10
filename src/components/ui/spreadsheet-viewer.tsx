import { useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, Search, Table, FileSpreadsheet } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SpreadsheetViewerProps {
  data?: Uint8Array | ArrayBuffer | string | null
  fileName?: string
  className?: string
  hideTitle?: boolean
}

interface SheetData {
  name: string
  rows: (string | number | boolean | null)[][]
}

/** 生成 Excel 列标签：0 -> A, 1 -> B, ..., 26 -> AA */
function getColumnLabel(index: number): string {
  let label = ''
  let num = index
  while (num >= 0) {
    label = String.fromCharCode(65 + (num % 26)) + label
    num = Math.floor(num / 26) - 1
  }
  return label
}

export function SpreadsheetViewer({ data, fileName, className, hideTitle = false }: SpreadsheetViewerProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetData[]>([])
  const [activeSheetIdx, setActiveSheetIdx] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!data) return
    let cancelled = false
    setLoading(true)
    setError(null)

    import('xlsx')
      .then((XLSX) => {
        if (cancelled) return
        let workbook
        if (typeof data === 'string') {
          workbook = XLSX.read(data, { type: 'string' })
        } else {
          workbook = XLSX.read(data, { type: 'array' })
        }

        const parsedSheets: SheetData[] = []
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName]
          const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            blankrows: false,
          }) as (string | number | boolean | null)[][]

          parsedSheets.push({
            name: sheetName,
            rows,
          })
        }

        if (!cancelled) {
          setSheets(parsedSheets)
          setActiveSheetIdx(0)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false)
          setError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
    }
  }, [data])

  const currentSheet = sheets[activeSheetIdx]

  // 计算当前表格的最大列数
  const maxCols = useMemo(() => {
    if (!currentSheet || !currentSheet.rows.length) return 0
    return Math.min(
      50, // 限制最大列数，防止异常宽表渲染卡死
      currentSheet.rows.reduce((max, r) => Math.max(max, r.length), 0)
    )
  }, [currentSheet])

  // 搜索过滤行
  const filteredRows = useMemo(() => {
    if (!currentSheet) return []
    if (!searchQuery.trim()) return currentSheet.rows.slice(0, 1000) // 限制渲染前 1000 行
    const q = searchQuery.toLowerCase().trim()
    return currentSheet.rows
      .filter((row) => row.some((cell) => String(cell ?? '').toLowerCase().includes(q)))
      .slice(0, 500)
  }, [currentSheet, searchQuery])

  if (loading) {
    return (
      <div className={cn("flex flex-col items-center justify-center w-full h-[70vh] gap-3 text-muted-foreground", className)}>
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="text-xs">正在解析电子表格数据...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center w-full h-[70vh] gap-2 p-6 text-center text-destructive", className)}>
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm font-medium">表格解析失败: {error}</p>
      </div>
    )
  }

  if (!currentSheet || currentSheet.rows.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center w-full h-[70vh] gap-2 text-muted-foreground", className)}>
        <FileSpreadsheet className="h-10 w-10 stroke-[1.2]" />
        <span className="text-xs">此工作表为空白</span>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col w-full h-[75vh] bg-background select-text", className)}>
      {/* 顶部工具栏：搜索与工作表摘要 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/70 bg-muted/20 shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {!hideTitle && (
            <>
              <Table className="h-4 w-4 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium truncate">
                {fileName || currentSheet.name}
              </span>
            </>
          )}
          {hideTitle && (
            <span className="text-xs font-medium text-foreground truncate">
              工作表: {currentSheet.name}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground font-mono shrink-0">
            ({currentSheet.rows.length.toLocaleString()} 行 × {maxCols} 列)
          </span>
        </div>
        <div className="relative w-48 sm:w-64">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="搜索表格内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs bg-background"
          />
        </div>
      </div>

      {/* 主表格展示区 */}
      <div className="flex-1 overflow-auto min-h-0 bg-background">
        <table className="min-w-full border-collapse text-xs font-mono text-foreground">
          <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur-sm shadow-xs">
            <tr>
              {/* 行号列头 */}
              <th className="w-12 px-2 py-1.5 border border-border/60 text-center text-[10px] text-muted-foreground font-medium bg-muted/60 select-none">
                #
              </th>
              {/* 列标：A, B, C... */}
              {Array.from({ length: maxCols }).map((_, cIdx) => (
                <th
                  key={cIdx}
                  className="px-3 py-1.5 border border-border/60 text-left text-[11px] font-semibold text-muted-foreground min-w-[90px] select-none"
                >
                  {getColumnLabel(cIdx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-muted/40 transition-colors odd:bg-background even:bg-muted/10">
                {/* 行号 */}
                <td className="px-2 py-1 border border-border/50 text-center text-[10px] text-muted-foreground/80 bg-muted/30 select-none font-sans">
                  {rIdx + 1}
                </td>
                {/* 单元格 */}
                {Array.from({ length: maxCols }).map((_, cIdx) => {
                  const val = row[cIdx]
                  const strVal = val !== undefined && val !== null ? String(val) : ''
                  return (
                    <td
                      key={cIdx}
                      className="px-3 py-1 border border-border/50 truncate max-w-[280px]"
                      title={strVal}
                    >
                      {strVal}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {currentSheet.rows.length > 1000 && !searchQuery && (
          <div className="py-2.5 text-center text-[11px] text-muted-foreground border-t border-border/40 select-none">
            已显示前 1000 行（大表格已截断，可通过上方搜索框检索指定行）
          </div>
        )}
      </div>

      {/* 底部工作表切换标签栏（多 Sheet 时展示） */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-t border-border/70 bg-muted/30 shrink-0 overflow-x-auto">
          {sheets.map((s, idx) => (
            <button
              key={s.name}
              onClick={() => {
                setActiveSheetIdx(idx)
                setSearchQuery('')
              }}
              className={cn(
                "px-3 py-1 text-xs rounded-md transition-all font-medium whitespace-nowrap",
                activeSheetIdx === idx
                  ? "bg-background text-foreground shadow-xs border border-border/80 font-semibold"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
              )}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
