import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ChevronLeft, File as FileIcon, Folder, Home, Loader2, RefreshCw, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import { QshellLoader } from '@/components/ui/qshell-loader'

/** 服务器（宿主机）文件选择对话框：浏览远端目录，选择文件/目录后回调其绝对路径 */
export interface RemoteFilePickerProps {
  open: boolean
  serverId: string
  onClose: () => void
  /** 回调选中的绝对路径数组（目录以自身路径返回） */
  onConfirm: (paths: string[]) => void
  /** 标题 */
  title?: string
  /** 起始目录，默认 "/" */
  initialPath?: string
}

/**
 * 说明：
 * - 点击进入目录（导航），点击"选择此项"可选中当前目录（用于复制整个文件夹）
 * - 文件行点击即选中/取消（多选由外层 onConfirm 决定如何用）
 * - 路径统一为绝对路径，目录不带尾斜杠（根为 "/"）
 */
export function RemoteFilePicker({
  open,
  serverId,
  onClose,
  onConfirm,
  title,
  initialPath = '/',
}: RemoteFilePickerProps) {
  const { t } = useTranslation()
  const [path, setPath] = useState(initialPath)
  const [entries, setEntries] = useState<Array<{
    name: string
    path: string
    isDirectory: boolean
    size: number
  }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const loadDir = useCallback(async (dir: string) => {
    setLoading(true)
    setError(null)
    try {
      const list = await sshService.listFiles(serverId, dir)
      // 只保留名称与类型，按目录优先、名称排序
      const mapped = (list || []).map((f) => ({
        name: f.name,
        path: f.path,
        isDirectory: !!f.isDirectory,
        size: f.size ?? 0,
      }))
      mapped.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      })
      setEntries(mapped)
      setPath(dir)
    } catch (err) {
      setEntries([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [serverId])

  // 打开时加载初始目录：整体延后到宏任务，避免 effect 内同步 setState
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      setSelected(new Set())
      void loadDir(initialPath)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, initialPath, loadDir])

  const parentPath = useMemo(() => {
    if (path === '/' || !path) return null
    const idx = path.lastIndexOf('/')
    return idx <= 0 ? '/' : path.slice(0, idx)
  }, [path])

  const toggleSelect = (p: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const handleConfirm = () => {
    // 未显式勾选任何条目时，视为选择当前目录本身
    const paths = selected.size > 0 ? [...selected] : [path]
    onConfirm(paths)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent showCloseButton={false} className="w-[92vw] max-w-2xl h-[75vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border/60 flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-sm">{title || t('dk_files_host_copy')}</DialogTitle>
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </DialogHeader>

        {/* 路径导航 */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/60">
          <button
            className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
            disabled={!parentPath}
            onClick={() => parentPath && void loadDir(parentPath)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="p-1 rounded hover:bg-accent text-muted-foreground"
            onClick={() => void loadDir('/')}
            title="/"
          >
            <Home className="h-3.5 w-3.5" />
          </button>
          <Input
            className="h-7 text-xs font-mono flex-1"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void loadDir(path.trim() || '/') }}
          />
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => void loadDir(path.trim() || '/')} disabled={loading}>
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
              <QshellLoader size="md" text={t('dk_loading')} />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-destructive text-sm px-4 text-center">{error}</div>
          ) : entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">{t('dk_files_empty')}</div>
          ) : (
            <div className="divide-y divide-border/30">
              {entries.map((e) => {
                const isSelected = selected.has(e.path)
                return (
                  <div
                    key={e.path}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 text-xs cursor-pointer hover:bg-accent/40',
                      isSelected && 'bg-primary/10'
                    )}
                    onClick={() => (e.isDirectory ? void loadDir(e.path) : toggleSelect(e.path))}
                  >
                    {e.isDirectory
                      ? <Folder className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      : <FileIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                    <span className="font-mono truncate flex-1" title={e.path}>{e.name}</span>
                    {e.isDirectory ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('h-6 text-[11px]', isSelected && 'text-primary')}
                        onClick={(ev) => { ev.stopPropagation(); toggleSelect(e.path) }}
                      >
                        {isSelected ? t('dk_files_selected') : t('dk_files_select_this')}
                      </Button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground w-20 text-right">{e.size}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 底部：已选 + 选择当前目录 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => toggleSelect(path)}
            >
              {selected.has(path) ? t('dk_files_selected') : t('dk_files_select_current_dir')}
            </Button>
            <span className="text-[11px] text-muted-foreground truncate">
              {selected.size > 0 ? `${selected.size} ${t('dk_files_selected_count')}` : path}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>
              {t('common_cancel')}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleConfirm}>
              {t('common_confirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
