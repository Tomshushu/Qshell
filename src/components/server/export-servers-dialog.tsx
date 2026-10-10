/**
 * 服务器导出对话框
 *
 * 功能：
 * - 显示所有服务器列表（带勾选框）
 * - 支持按标签快速选中（点击标签 = 选中带该标签的全部服务器）
 * - 支持全选 / 反选
 * - 支持手动逐条勾选
 * - 输入导出密码（用于加密 JSON 备份中的敏感字段）
 * - 调用 Tauri dialog.save() 让用户选择保存路径
 * - 调用 sshService.exportServers() 写入加密 JSON 文件
 *
 * 安全设计：
 * - 密码至少 6 位
 * - 需要二次输入确认密码一致
 * - 密码仅传给后端，前端不留存
 */

import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import { sshService } from '@/services/ssh-service'
import { save } from '@tauri-apps/plugin-dialog'
import {
  Loader2,
  Search,
  Check,
  Square,
  CheckSquare,
  Eye,
  EyeOff,
  AlertCircle,
  Download,
} from 'lucide-react'
import type { Server } from '@/types'

interface ExportServersDialogProps {
  open: boolean
  onClose: () => void
  /**
   * 打开对话框时预选的服务器 id 列表。
   * - 右键"导出此服务器"时传 [server.id]
   * - 从工具栏触发"导出全部"时传 undefined（不预选）
   */
  preselectIds?: string[]
}

export function ExportServersDialog({ open, onClose, preselectIds }: ExportServersDialogProps) {
  const { servers } = useAppStore()
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  // 对话框打开时按会话特征重置状态（支持条件挂载初次渲染与 preselectIds 切换）
  const sessionKey = open ? `open:${preselectIds?.join(',') ?? 'all'}` : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) {
      // 若有预选（右键"导出此服务器"），用预选；否则默认不勾选任何项
      setSelectedIds(preselectIds && preselectIds.length > 0 ? new Set(preselectIds) : new Set())
      setSearchQuery('')
      setTagFilter(null)
      setPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setExporting(false)
      setError(null)
      setResult(null)
    }
  }

  // 所有可用标签
  const allTags = useMemo(
    () => [...new Set(servers.flatMap((s) => s.tags))].sort(),
    [servers],
  )

  // 筛选后的服务器列表（用于展示，不改变选中状态）
  const filteredServers = useMemo(() => {
    let list = [...servers].sort((a, b) => a.name.localeCompare(b.name))
    if (tagFilter) {
      list = list.filter((s) => s.tags.includes(tagFilter!))
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [servers, tagFilter, searchQuery])

  // 当前筛选条件下的服务器 id 集合（用于"全选当前筛选"）
  const filteredIds = useMemo(
    () => new Set(filteredServers.map((s) => s.id)),
    [filteredServers],
  )

  const selectedCount = selectedIds.size
  const totalServers = servers.length

  const handleToggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // 全选当前筛选结果（不影响未显示的）
  const handleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      filteredIds.forEach((id) => next.add(id))
      return next
    })
  }

  // 取消全选当前筛选结果
  const handleUnselectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      filteredIds.forEach((id) => next.delete(id))
      return next
    })
  }

  // 全选全部服务器
  const handleSelectAll = () => {
    setSelectedIds(new Set(servers.map((s) => s.id)))
  }

  // 清空选中
  const handleClearAll = () => {
    setSelectedIds(new Set())
  }

  // 点击标签：选中带此标签的所有服务器
  const handleTagClick = (tag: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      servers.filter((s) => s.tags.includes(tag)).forEach((s) => next.add(s.id))
      return next
    })
  }

  const handleExport = async () => {
    setError(null)
    setResult(null)

    // 校验
    if (selectedIds.size === 0) {
      setError(t('exp_err_select_one'))
      return
    }
    if (password.length < 6) {
      setError(t('exp_err_password_short'))
      return
    }
    if (password !== confirmPassword) {
      setError(t('exp_err_password_mismatch'))
      return
    }

    setExporting(true)
    try {
      // 1. 让用户选择保存路径
      const filePath = await save({
        defaultPath: `servers-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [
          { name: 'Qshell JSON', extensions: ['json'] },
        ],
      })

      if (!filePath) {
        // 用户取消
        setExporting(false)
        return
      }

      // 2. 调用后端导出
      const ids = Array.from(selectedIds)
      const r = await sshService.exportServers(filePath, ids, password)
      if (r.success) {
        setResult(r.message || t('exp_success').replace('{n}', String(ids.length)))
        // 关闭对话框，让用户看到 dashboard 上的成功提示
        setTimeout(() => {
          onClose()
        }, 2000)
      } else {
        setError(r.error || t('exp_failed'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  const isFilteredAllSelected =
    filteredIds.size > 0 &&
    Array.from(filteredIds).every((id) => selectedIds.has(id))

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            {t('exp_title')}
          </DialogTitle>
          <DialogDescription>
            {t('exp_desc')}
          </DialogDescription>
        </DialogHeader>

        {/* 工具栏：搜索 + 标签筛选 + 全选/反选 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t('exp_search_placeholder')}
                value={searchQuery}
                maxLength={100}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={isFilteredAllSelected ? handleUnselectAllFiltered : handleSelectAllFiltered}
              disabled={filteredServers.length === 0}
            >
              {isFilteredAllSelected ? t('exp_unselect_current') : t('exp_select_current')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleSelectAll}
              disabled={totalServers === 0}
            >
              {t('exp_select_all')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={handleClearAll}
              disabled={selectedCount === 0}
            >
              {t('exp_clear')}
            </Button>
          </div>

          {/* 标签快速筛选 + 选中 */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">{t('exp_tag_filter_hint')}</span>
              {tagFilter && (
                <button
                  onClick={() => setTagFilter(null)}
                  className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-accent"
                >
                  {t('exp_clear_filter')}
                </button>
              )}
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setTagFilter(tagFilter === tag ? null : tag)
                    handleTagClick(tag)
                  }}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    tagFilter === tag
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 服务器列表 */}
        <div className="border rounded-md flex-1 min-h-0">
          <ScrollArea className="h-[280px]">
            {filteredServers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <AlertCircle className="h-8 w-8 mb-2 opacity-40" />
                <p className="text-xs">
                  {totalServers === 0 ? t('exp_no_servers') : t('exp_no_matches')}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredServers.map((server) => (
                  <ServerRow
                    key={server.id}
                    server={server}
                    selected={selectedIds.has(server.id)}
                    onToggle={() => handleToggle(server.id)}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 选中统计 */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t('exp_selected_count').replace('{n}', String(selectedCount)).replace('{total}', String(totalServers))}
            {tagFilter && <span className="ml-2">（{t('exp_filtered')}: {tagFilter}）</span>}
          </span>
          {selectedCount > 0 && (
            <span className="text-success">{t('exp_will_export').replace('{n}', String(selectedCount))}</span>
          )}
        </div>

        {/* 导出密码输入 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium mb-1 block">{t('exp_password_label')}</label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                maxLength={256}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('exp_password_placeholder')}
                className="h-8 pr-8 text-xs"
                disabled={exporting}
                autoComplete="new-password"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">{t('exp_password_confirm')}</label>
            <Input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              maxLength={256}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('exp_password_confirm_placeholder')}
              className="h-8 text-xs"
              disabled={exporting}
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !exporting) {
                  void handleExport()
                }
              }}
            />
          </div>
        </div>

        {/* 错误 / 成功提示 */}
        {error && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-xs border border-destructive/20">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {result && (
          <div className="flex items-center gap-2 p-2 rounded-md bg-success/10 text-success text-xs border border-success/20">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{result}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={exporting}>
            {t('exp_cancel')}
          </Button>
          <Button
            onClick={handleExport}
            disabled={
              exporting ||
              selectedCount === 0 ||
              password.length < 6 ||
              password !== confirmPassword
            }
          >
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                {t('btn_exporting')}
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                {selectedCount > 0 ? t('exp_export_n').replace('{n}', String(selectedCount)) : t('dash_export')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 服务器行：勾选框 + 名称 + IP + 标签 */
function ServerRow({
  server,
  selected,
  onToggle,
}: {
  server: Server
  selected: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 cursor-pointer text-xs"
    >
      <button
        type="button"
        className="flex-shrink-0 text-primary"
        tabIndex={-1}
      >
        {selected ? (
          <CheckSquare className="h-4 w-4" />
        ) : (
          <Square className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="font-medium truncate">{server.name}</span>
        <span className="font-mono text-muted-foreground truncate">{server.host}:{server.port}</span>
        <span className="text-muted-foreground truncate">@{server.username}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {server.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]"
          >
            {tag}
          </span>
        ))}
        {server.tags.length > 2 && (
          <span className="text-[10px] text-muted-foreground">+{server.tags.length - 2}</span>
        )}
      </div>
    </div>
  )
}
