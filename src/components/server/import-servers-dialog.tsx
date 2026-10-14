import { useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { sshService } from '@/services/ssh-service'
import { backend } from '@/services/api'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type { ExternalImportCandidate, ExternalImportPreview, ExternalImportSource, ImportResult } from '@/services/api'
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, FileCode2, FileText, FolderOpen, KeyRound, Loader2, MonitorDown, Server, ShieldAlert, TerminalSquare, Upload, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImportServersDialogProps { open: boolean; onClose: () => void }
type ImportSource = 'workspace' | ExternalImportSource

const SOURCE_OPTIONS: Array<{ id: ImportSource; icon: typeof Server; titleKey: string; descKey: string }> = [
  { id: 'workspace', icon: Server, titleKey: 'imp_source_workspace', descKey: 'imp_source_workspace_json_desc' },
  { id: 'openssh', icon: FileCode2, titleKey: 'imp_source_openssh', descKey: 'imp_source_openssh_desc' },
  { id: 'putty_registry', icon: MonitorDown, titleKey: 'imp_source_putty', descKey: 'imp_source_putty_desc' },
  { id: 'xshell', icon: TerminalSquare, titleKey: 'imp_source_xshell', descKey: 'imp_source_xshell_desc' },
  { id: 'finalshell', icon: TerminalSquare, titleKey: 'imp_source_finalshell', descKey: 'imp_source_finalshell_desc' },
  { id: 'securecrt', icon: Server, titleKey: 'imp_source_securecrt', descKey: 'imp_source_securecrt_desc' },
]

export function ImportServersDialog({ open, onClose }: ImportServersDialogProps) {
  const { setServers, setKeys } = useAppStore()
  const { t } = useTranslation()
  const { toast } = useToast()
  const [source, setSource] = useState<ImportSource>('workspace')
  const [filePath, setFilePath] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [preview, setPreview] = useState<ExternalImportPreview | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [skipDuplicates, setSkipDuplicates] = useState(true)

  // 打开时重置向导状态（以会话标识驱动，兼容条件挂载初次渲染，避免在 effect 内同步 setState）
  const sessionKey = open ? 'open' : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open) {
      setSource('workspace'); setFilePath(''); setPassword(''); setShowPassword(false); setBusy(false)
      setError(null); setResult(null); setPreview(null); setSelectedIds(new Set()); setSkipDuplicates(true)
    }
  }

  const refreshServers = async () => {
    try {
      const dbServers = await sshService.listServers()
      // sshService.listServers 已由适配层完成 snake_case→camelCase 归一化与 tags/protocols 解析，
      // 此处直接使用，避免白名单重建丢字段
      setServers(dbServers)
    } catch (e) { console.error('Failed to refresh servers:', e) }
    try { if (backend?.sshKeys) setKeys(await backend.sshKeys.list()) } catch (e) { console.error('Failed to refresh keys:', e) }
  }

  const selectSource = (next: ImportSource) => {
    setSource(next); setFilePath(''); setPassword(''); setError(null); setResult(null); setPreview(null); setSelectedIds(new Set())
  }

  const choosePath = async (directory = false, requestedSource?: ExternalImportSource) => {
    if (!source) return
    setError(null)
    try {
      const effectiveSource = requestedSource || source
      const filters = effectiveSource === 'workspace'
        ? [{ name: 'Qshell JSON', extensions: ['json'] }]
        : effectiveSource === 'putty_file'
          ? [{ name: 'Windows Registry Export', extensions: ['reg'] }]
          : effectiveSource === 'xshell'
            ? [{ name: 'Xshell Session', extensions: ['xsh'] }]
            : effectiveSource === 'finalshell'
              ? [{ name: 'FinalShell JSON', extensions: ['json'] }]
              : effectiveSource === 'securecrt'
                ? [{ name: 'SecureCRT Session', extensions: ['ini', 'txt'] }]
                : [{ name: 'OpenSSH Config', extensions: ['config', 'conf', '*'] }]
      const selected = await openDialog({ multiple: false, directory, filters: directory ? undefined : filters })
      if (typeof selected === 'string' && selected) {
        if (requestedSource) setSource(requestedSource)
        setFilePath(selected); setPreview(null); setResult(null); setSelectedIds(new Set())
      }
    } catch (e) { setError(e instanceof Error ? e.message : t('imp_err_file_select')) }
  }

  const usePuttyRegistry = () => {
    setSource('putty_registry'); setFilePath(''); setError(null); setResult(null); setPreview(null); setSelectedIds(new Set())
  }

  const parseExternal = async () => {
    if (!source || source === 'workspace') return
    if (source !== 'putty_registry' && !filePath) return setError(t('imp_err_no_file'))
    setBusy(true); setError(null); setResult(null)
    try {
      const parsed = await sshService.parseExternalImport(source, filePath || undefined)
      setPreview(parsed)
      setSelectedIds(new Set(parsed.candidates.filter((item) => !item.duplicate).map((item) => item.sourceId)))
      if (!parsed.candidates.length) setError(t('imp_external_empty'))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const importWorkspace = async () => {
    if (!filePath) return setError(t('imp_err_no_file'))
    if (!password) return setError(t('imp_err_no_password'))
    setBusy(true); setError(null)
    try {
      const imported = await sshService.importServers(filePath, password)
      setResult(imported)
      if (imported.imported > 0) await refreshServers()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const importExternal = async () => {
    if (!preview) return
    const candidates = preview.candidates.filter((item) => selectedIds.has(item.sourceId))
    if (!candidates.length) return setError(t('imp_external_select_one'))
    setBusy(true); setError(null)
    try {
      const imported = await sshService.importExternalServers(candidates, skipDuplicates)
      setResult(imported)
      if (imported.imported > 0) {
        await refreshServers()
        toast.success(t('imp_external_imported', { count: imported.imported }))
        const pendingCount = candidates.filter(candidateNeedsCredential).length
        if (pendingCount > 0) toast.warning(t('imp_auth_pending_notice', { count: pendingCount }))
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const handleClose = () => { if (result?.imported) void refreshServers(); onClose() }
  const selectedCount = selectedIds.size
  const duplicateCount = preview?.candidates.filter((item) => item.duplicate).length || 0
  const pendingCredentialCount = preview?.candidates.filter((item) => selectedIds.has(item.sourceId) && candidateNeedsCredential(item)).length || 0
  const selectableIds = useMemo(() => preview?.candidates.filter((item) => !(skipDuplicates && item.duplicate)).map((item) => item.sourceId) || [], [preview, skipDuplicates])
  const toggleAll = () => {
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds))
  }

  const activeSourceId = source === 'putty_file' ? 'putty_registry' : source
  const activeSource = SOURCE_OPTIONS.find((item) => item.id === activeSourceId) || SOURCE_OPTIONS[0]

  return <Dialog open={open} onOpenChange={(value) => { if (!value) handleClose() }}>
    <DialogContent className="max-w-[780px] w-[min(780px,calc(100vw-2rem))] h-[min(680px,calc(100vh-2rem))] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
      <DialogHeader className="px-5 py-3 pr-12 border-b border-border/60 flex-shrink-0 bg-muted/20 flex flex-row items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5 shrink-0">
          <Upload className="h-4 w-4 text-primary shrink-0" />
          <DialogTitle className="text-sm font-semibold text-foreground whitespace-nowrap">
            {t('imp_title')}
          </DialogTitle>
        </div>
        <span
          className="max-w-[400px] truncate text-xs text-muted-foreground select-none text-right"
          title={t(activeSource.descKey)}
        >
          {t(activeSource.descKey)}
        </span>
        <DialogDescription className="sr-only">{t('imp_choose_source_desc')}</DialogDescription>
      </DialogHeader>

      {error && <div className="px-5 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs font-medium flex items-center gap-2 shrink-0"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{error}</span></div>}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="w-40 shrink-0 border-r border-border/60 bg-muted/15 p-2 overflow-y-auto">
          <div className="border border-input rounded bg-background p-1 space-y-0.5 shadow-2xs">
            {SOURCE_OPTIONS.map((option) => { const Icon = option.icon; const selected = option.id === activeSourceId; return <button key={option.id} type="button" onClick={() => selectSource(option.id)} disabled={busy} className={cn('w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs font-medium transition-colors text-left', selected ? 'bg-primary text-primary-foreground font-semibold' : 'text-foreground hover:bg-muted')}><Icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t(option.titleKey)}</span></button> })}
          </div>
          <p className="px-1.5 pt-3 text-[10px] leading-relaxed text-muted-foreground">{source === 'workspace' ? t('imp_workspace_security_hint') : t('imp_external_step_desc')}</p>
        </div>

        <div className="flex-1 min-w-0 overflow-y-auto p-4 bg-background">
          {!result && source === 'workspace' && <WorkspaceImportForm filePath={filePath} password={password} showPassword={showPassword} busy={busy} onChoose={() => void choosePath(false)} onPassword={setPassword} onTogglePassword={() => setShowPassword((value) => !value)} t={t} />}
          {!result && source !== 'workspace' && !preview && <ExternalSourceForm source={source} filePath={filePath} choosePath={choosePath} usePuttyRegistry={usePuttyRegistry} t={t} />}
          {!result && preview && <ExternalPreview preview={preview} selectedIds={selectedIds} setSelectedIds={setSelectedIds} skipDuplicates={skipDuplicates} setSkipDuplicates={setSkipDuplicates} toggleAll={toggleAll} selectedCount={selectedCount} duplicateCount={duplicateCount} t={t} />}
          {result && <ImportResultView result={result} pendingCredentialCount={pendingCredentialCount} t={t} />}
        </div>
      </div>

      <div className="px-5 py-2.5 border-t border-border/60 bg-muted/20 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] text-muted-foreground">{preview && !result ? t('imp_preview_summary', { total: preview.candidates.length, selected: selectedCount }) : t(activeSource.titleKey)}</span>
        <div className="flex items-center gap-2">
          {source === 'workspace' && !result && <Button size="sm" className="h-7 px-5 text-xs font-semibold" onClick={() => void importWorkspace()} disabled={busy || !filePath || !password}>{busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}{t('imp_btn_import')}</Button>}
          {source !== 'workspace' && !preview && !result && <Button size="sm" className="h-7 px-4 text-xs font-semibold" onClick={() => void parseExternal()} disabled={busy || (source !== 'putty_registry' && !filePath)}>{busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileCode2 className="mr-1 h-3 w-3" />}{t('imp_parse_preview')}</Button>}
          {preview && !result && <Button size="sm" className="h-7 px-4 text-xs font-semibold" onClick={() => void importExternal()} disabled={busy || selectedCount === 0}>{busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Upload className="mr-1 h-3 w-3" />}{t('imp_import_selected', { count: selectedCount })}</Button>}
          <Button variant="outline" size="sm" className="h-7 px-4 text-xs" onClick={handleClose} disabled={busy}>{result ? t('imp_btn_close') : t('common_cancel')}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

function translateImportWarning(message: string, t: Translate): string {
  const exact: Record<string, string> = {
    'Xshell stored password was intentionally not decrypted; enter it on first connection.': 'imp_warning_xshell_password',
    'FinalShell stored password was intentionally not decrypted; enter it on first connection.': 'imp_warning_finalshell_password',
    'SecureCRT stored password was intentionally not decrypted; enter it on first connection.': 'imp_warning_securecrt_password',
    'PuTTY does not normally store login passwords; provide it on first connection if required.': 'imp_warning_putty_password',
    'Password is not stored in OpenSSH config and must be provided on first connection.': 'imp_warning_openssh_password',
    'Username was not specified.': 'imp_warning_username_missing',
    'Include directives are not expanded in this version; import included files separately.': 'imp_warning_openssh_include',
    'Match blocks were skipped because they are conditional.': 'imp_warning_openssh_match',
  }
  return exact[message] ? t(exact[message]) : message
}

function candidateNeedsCredential(candidate: ExternalImportCandidate): boolean {
  return candidate.warnings.some((message) =>
    message.includes('not decrypted') ||
    message.includes('not normally store') ||
    message.includes('Password is not stored')
  )
}

function WorkspaceImportForm({ filePath, password, showPassword, busy, onChoose, onPassword, onTogglePassword, t }: { filePath: string; password: string; showPassword: boolean; busy: boolean; onChoose: () => void; onPassword: (value: string) => void; onTogglePassword: () => void; t: Translate }) {
  return <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs"><legend className="px-1.5 text-xs font-medium text-foreground">{t('imp_source_workspace')}</legend><div className="flex items-center gap-3"><label className="w-20 shrink-0 text-right text-xs text-foreground">{t('imp_file_label')}:</label><div className="flex flex-1 gap-2"><Input value={filePath} readOnly placeholder={t('imp_workspace_json_placeholder')} className="h-7 text-xs bg-background" /><Button variant="outline" size="sm" className="h-7 gap-1.5 px-3 text-xs" onClick={onChoose} disabled={busy}><FolderOpen className="h-3.5 w-3.5" />{t('imp_btn_select_file')}</Button></div></div><div className="flex items-center gap-3"><label className="w-20 shrink-0 text-right text-xs text-foreground">{t('imp_password_label')}:</label><div className="relative flex-1"><Input type={showPassword ? 'text' : 'password'} value={password} maxLength={256} onChange={(event) => onPassword(event.target.value)} placeholder={t('imp_password_placeholder')} className="h-7 pr-8 text-xs bg-background" /><button type="button" onClick={onTogglePassword} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></div></div><div className="ml-[5.75rem] rounded bg-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{t('imp_workspace_security_hint')}</div></fieldset>
}

function ExternalSourceForm({ source, filePath, choosePath, usePuttyRegistry, t }: { source: ExternalImportSource; filePath: string; choosePath: (directory?: boolean, requestedSource?: ExternalImportSource) => Promise<void>; usePuttyRegistry: () => void; t: Translate }) {
  const isPutty = source === 'putty_registry' || source === 'putty_file'
  const sourceLegend = isPutty
    ? t('imp_source_putty')
    : source === 'xshell'
      ? t('imp_source_xshell')
      : source === 'finalshell'
        ? t('imp_source_finalshell')
        : source === 'securecrt'
          ? t('imp_source_securecrt')
          : t('imp_source_openssh')
  const pathLabel = isPutty
    ? t('imp_putty_path')
    : source === 'xshell'
      ? t('imp_xshell_path')
      : source === 'finalshell'
        ? t('imp_finalshell_path')
        : source === 'securecrt'
          ? t('imp_securecrt_path')
          : t('imp_file_label')
  const pathPlaceholder = isPutty
    ? t('imp_putty_placeholder')
    : source === 'xshell'
      ? t('imp_xshell_placeholder')
      : source === 'finalshell'
        ? t('imp_finalshell_placeholder')
        : source === 'securecrt'
          ? t('imp_securecrt_placeholder')
          : t('imp_external_file_placeholder')
  const canSelectFolder = source === 'xshell' || source === 'finalshell' || source === 'securecrt'

  return <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-3 bg-card/20 shadow-2xs"><legend className="px-1.5 text-xs font-medium text-foreground">{sourceLegend}</legend><div className="flex items-center gap-3"><label className="w-24 shrink-0 text-right text-xs text-foreground">{pathLabel}:</label><div className="flex flex-1 gap-2"><Input readOnly value={isPutty && source === 'putty_registry' ? t('imp_putty_local_selected') : filePath} placeholder={pathPlaceholder} className="h-7 text-xs bg-background" />{isPutty ? <><Button variant={source === 'putty_registry' ? 'secondary' : 'outline'} size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={usePuttyRegistry}><MonitorDown className="h-3.5 w-3.5" />{t('imp_putty_use_local')}</Button><Button variant={source === 'putty_file' ? 'secondary' : 'outline'} size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void choosePath(false, 'putty_file')}><FileText className="h-3.5 w-3.5" />{t('imp_putty_select_reg')}</Button></> : <><Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void choosePath(false)}><FileText className="h-3.5 w-3.5" />{t('imp_btn_select_file')}</Button>{canSelectFolder && <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => void choosePath(true)}><FolderOpen className="h-3.5 w-3.5" />{t('imp_select_folder')}</Button>}</>}</div></div>{isPutty && <p className="ml-[6.75rem] text-[11px] text-muted-foreground">{source === 'putty_registry' ? t('imp_putty_registry_hint') : t('imp_putty_file_hint')}</p>}<div className="ml-[6.75rem] flex items-start gap-2 rounded bg-amber-500/8 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300"><KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{t('imp_no_password_decrypt')}</span></div></fieldset>
}

function ExternalPreview({ preview, selectedIds, setSelectedIds, skipDuplicates, setSkipDuplicates, toggleAll, selectedCount, duplicateCount, t }: { preview: ExternalImportPreview; selectedIds: Set<string>; setSelectedIds: (value: Set<string>) => void; skipDuplicates: boolean; setSkipDuplicates: (value: boolean) => void; toggleAll: () => void; selectedCount: number; duplicateCount: number; t: Translate }) {
  const toggle = (candidate: ExternalImportCandidate) => { if (skipDuplicates && candidate.duplicate) return; const next = new Set(selectedIds); if (next.has(candidate.sourceId)) next.delete(candidate.sourceId); else next.add(candidate.sourceId); setSelectedIds(next) }
  const previewHeight = Math.min(420, Math.max(82, preview.candidates.length * 78))
  return <fieldset className="border border-border/70 rounded-md p-0 pt-1 bg-card/20 shadow-2xs overflow-hidden"><legend className="mx-3 px-1.5 text-xs font-medium text-foreground">{t('imp_parse_preview')}</legend><div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2"><div className="flex items-center gap-2 text-xs"><button type="button" onClick={toggleAll} className="flex items-center gap-1.5 font-medium"><span className={cn('flex h-4 w-4 items-center justify-center rounded border', selectedCount > 0 && 'border-primary bg-primary text-primary-foreground')}><Check className="h-3 w-3" /></span>{t('imp_select_all')}</button><span className="text-muted-foreground">{t('imp_preview_summary', { total: preview.candidates.length, selected: selectedCount })}</span>{duplicateCount > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">{t('imp_duplicate_count', { count: duplicateCount })}</span>}</div>{duplicateCount > 0 && <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={skipDuplicates} onChange={(event) => { setSkipDuplicates(event.target.checked); if (event.target.checked) setSelectedIds(new Set([...selectedIds].filter((id) => !preview.candidates.find((item) => item.sourceId === id)?.duplicate))) }} />{t('imp_skip_duplicate_hosts')}</label>}</div>{preview.warnings.length > 0 && <div className="border-b bg-amber-500/8 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><ShieldAlert className="mr-1.5 inline h-3.5 w-3.5" />{preview.warnings.map((message) => translateImportWarning(message, t)).join(' ')}</div>}<ScrollArea style={{ height: previewHeight }}><div className="divide-y">{preview.candidates.map((item) => { const checked = selectedIds.has(item.sourceId); const disabled = skipDuplicates && item.duplicate; const needsCredential = candidateNeedsCredential(item); return <button key={item.sourceId} type="button" onClick={() => toggle(item)} disabled={disabled} className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-accent/40', checked && 'bg-primary/[0.04]', disabled && 'cursor-not-allowed opacity-50')}><span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', checked && 'border-primary bg-primary text-primary-foreground')}><Check className="h-3 w-3" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><span className="truncate text-sm font-medium">{item.name}</span><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{item.protocol}</span>{needsCredential && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] text-orange-700 dark:text-orange-300">{t('imp_auth_pending')}</span>}{item.duplicate && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">{t('imp_duplicate')}</span>}</span><span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">{item.username ? `${item.username}@` : ''}{item.host}:{item.port}</span>{item.warnings.length > 0 && <span className="mt-1 block text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">{item.warnings.map((message) => translateImportWarning(message, t)).join(' ')}</span>}</span></button> })}</div></ScrollArea></fieldset>
}

function ImportResultView({ result, pendingCredentialCount, t }: { result: ImportResult; pendingCredentialCount: number; t: Translate }) {
  return <fieldset className="border border-border/70 rounded-md p-3.5 pt-1 space-y-2.5 bg-card/20 shadow-2xs"><legend className="px-1.5 text-xs font-medium text-foreground">{t('imp_result_title')}</legend>{result.success ? <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />{t('imp_result_success', { imported: result.imported, total: result.total })}</div> : <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive"><XCircle className="mt-0.5 h-4 w-4" />{result.error || t('imp_result_failed')}</div>}{pendingCredentialCount > 0 && result.imported > 0 && <div className="flex items-start gap-2 rounded-md border border-orange-500/20 bg-orange-500/8 p-2.5 text-xs text-orange-700 dark:text-orange-300"><KeyRound className="mt-0.5 h-4 w-4 shrink-0" /><span>{t('imp_auth_pending_notice', { count: pendingCredentialCount })}</span></div>}{result.errors && result.errors.length > 0 && <ScrollArea className="h-24 rounded-md border"><div className="divide-y text-xs">{result.errors.map((message, index) => <div key={`${index}-${message}`} className="px-2 py-1.5">{message}</div>)}</div></ScrollArea>}</fieldset>
}
