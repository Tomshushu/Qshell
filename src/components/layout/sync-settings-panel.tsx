/**
 * src/components/layout/sync-settings-panel.tsx
 *
 * Qshell 云端多端同步控制中心（Gitee + GitHub 双擎驱动）：
 * 1. 采用端到端零知识加密（E2EE），主密码绝不上云；
 * 2. 状态驱动 UX：未绑定时展示输入框，绑定后自动切换为【已关联账号卡片】，防误触且安全防窥；
 * 3. 主密码支持防误触锁定态与编辑态，保障资产绝对安全；
 * 4. 支持 Gitee（国内 15ms 秒级直连）与 GitHub（全球开发者首选）无缝切换；
 * 5. 一键加密备份与云端恢复，支持 Git Commit 历史快照版本回滚；
 * 6. 匿名数据统计（Local-First 原则，支持随时关闭）。
 */

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useSyncStore, type SyncProvider } from '@/store/sync-store'
import { useToast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useTranslation } from '@/i18n'
import {
  isTelemetryEnabled,
  setTelemetryEnabled,
} from '@/services/telemetry'
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  KeyRound,
  ShieldCheck,
  ExternalLink,
  History,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Lock,
  Eye,
  EyeOff,
  Copy,
  Check,
  GitBranch,
  Globe,
  Sparkles,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function SyncSettingsPanel() {
  const { t, language } = useTranslation()
  const { toast } = useToast()
  const {
    provider,
    masterPassword,
    currentUser,
    currentToken,
    isConfigured,
    isSyncing,
    lastSyncTime,
    lastSyncResult,
    historyList,
    historyLimit,
    hasMoreHistory,
    isLoadingMoreHistory,
    autoSync,
    setAutoSync,
    setProvider,
    setToken,
    clearToken,
    setMasterPassword,
    clearMasterPassword,
    backup,
    restore,
    fetchHistory,
    loadMoreHistory,
    resetHistoryLimit,
  } = useSyncStore()

  // 状态管理：Token 编辑态与主密码编辑态
  const [inputToken, setInputToken] = useState('')
  const [isEditingToken, setIsEditingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showConnectedToken, setShowConnectedToken] = useState(false)
  const [copiedField, setCopiedField] = useState<'token' | 'password' | null>(null)

  const [inputMasterPassword, setInputMasterPassword] = useState(masterPassword)
  const [isEditingPassword, setIsEditingPassword] = useState(!masterPassword)
  const [showPassword, setShowPassword] = useState(false)

  const [telemetryActive, setTelemetryActive] = useState(isTelemetryEnabled())
  const [isVerifying, setIsVerifying] = useState(false)

  // 复制文本到剪贴板
  const handleCopy = async (text: string, label: string, field: 'token' | 'password') => {
    if (!text) {
      toast.warning(t('sync_toast_no_content', { label }))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success(t('sync_toast_copied', { label }))
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error(t('sync_toast_copy_failed'))
    }
  }

  // 当切换提供商或 Token 变更时同步
  useEffect(() => {
    setInputToken(currentToken)
    setIsEditingToken(false)
  }, [currentToken, provider])

  // 主密码变更同步
  useEffect(() => {
    setInputMasterPassword(masterPassword)
    if (masterPassword) {
      setIsEditingPassword(false)
    } else {
      setIsEditingPassword(true)
    }
  }, [masterPassword])

  // 保存并验证 Token
  const handleSaveToken = async () => {
    const platform = provider === 'gitee' ? 'Gitee' : 'GitHub'
    if (!inputToken.trim()) {
      toast.warning(t('sync_toast_token_required', { platform }))
      return
    }
    setIsVerifying(true)
    const res = await setToken(inputToken)
    setIsVerifying(false)

    if (res.success) {
      setIsEditingToken(false)
      toast.success(t('sync_toast_token_verified', { platform }))
    } else {
      toast.error(t('sync_toast_token_failed', { error: res.error || '' }))
    }
  }

  // 解绑 Token
  const handleClearToken = () => {
    clearToken()
    setInputToken('')
    setIsEditingToken(false)
    toast.info(t('sync_toast_unbound'))
  }

  // 保存并锁定主密码
  const handleSavePassword = () => {
    const trimmed = inputMasterPassword.trim()
    if (!trimmed) {
      toast.warning(t('sync_toast_pwd_required'))
      return
    }
    setMasterPassword(trimmed)
    setIsEditingPassword(false)
    toast.success(t('sync_toast_pwd_saved'))
  }

  // 立即备份
  const handleBackup = async () => {
    if (!masterPassword.trim()) {
      toast.warning(t('sync_toast_pwd_needed_for_backup'))
      return
    }
    const res = await backup()
    const platform = provider === 'gitee' ? 'Gitee' : 'GitHub'
    if (res.success) {
      toast.success(t('sync_toast_backup_success', { platform }))
    } else {
      toast.error(t('sync_toast_backup_failed', { error: res.error || '' }))
    }
  }

  // 从云端恢复
  const handleRestore = async (commitSha?: string) => {
    if (!masterPassword.trim()) {
      toast.warning(t('sync_toast_pwd_needed_for_restore'))
      return
    }
    const res = await restore(undefined, commitSha)
    if (res.success) {
      const stats = res.stats
      const details: string[] = []
      if (stats?.servers !== undefined) details.push(t('sync_stat_servers', { n: stats.servers }))
      if (stats?.groups) details.push(t('sync_stat_groups', { n: stats.groups }))
      if (stats?.sshKeys) details.push(t('sync_stat_ssh_keys', { n: stats.sshKeys }))
      if (stats?.tags) details.push(t('sync_stat_tags', { n: stats.tags }))
      if (stats?.backgrounds) details.push(t('sync_stat_backgrounds', { n: stats.backgrounds }))
      const detailStr = details.length > 0 ? t('sync_stat_and_settings', { items: details.join(', ') }) : ''
      toast.success(t('sync_toast_restore_success', { details: detailStr }))
    } else {
      toast.error(t('sync_toast_restore_failed', { error: res.error || '' }))
    }
  }

  const handleToggleTelemetry = () => {
    const next = !telemetryActive
    setTelemetryActive(next)
    setTelemetryEnabled(next)
    toast.info(next ? t('sync_toast_telemetry_on') : t('sync_toast_telemetry_off'))
  }

  const isGitee = provider === 'gitee'
  const tokenHelpUrl = isGitee
    ? 'https://gitee.com/profile/personal_access_tokens/new'
    : 'https://github.com/settings/tokens/new?scopes=repo&description=Qshell+Cloud+Backup'

  return (
    <div className="space-y-4">
      {/* 1. 顶部紧凑标题栏 + 平台切换器 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
                isGitee
                  ? 'bg-red-500/10 border-red-500/20 text-red-500'
                  : 'bg-primary/10 border-primary/20 text-primary',
              )}
            >
              <Cloud className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {isGitee ? t('sync_gitee_title') : t('sync_github_title')}
            </h3>
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500 border border-emerald-500/20">
                <CheckCircle2 className="h-3 w-3" />
                {t('sync_status_connected')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground border border-border">
                {t('sync_status_unbound')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            {t('sync_scenario_desc_3')}
          </p>
        </div>

        {/* 平台分段切换器 */}
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setProvider('gitee')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              isGitee
                ? 'bg-red-500 text-white shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span>🇨🇳 Gitee</span>
          </button>
          <button
            type="button"
            onClick={() => setProvider('github')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
              !isGitee
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>GitHub</span>
          </button>
        </div>
      </div>

      {/* 2. 核心凭证与安全配置 (对称两列紧凑卡片) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* 卡片 1: 平台访问令牌 / 已关联账号 */}
        <Card className="border-border/60 bg-card/60 flex flex-col justify-between">
          <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
            {isConfigured && currentUser && !isEditingToken ? (
              /* ── 已关联状态 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{isGitee ? t('sync_account_connected_gitee') : t('sync_account_connected_github')}</span>
                  </span>
                  <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    {t('sync_connection_ready')}
                  </span>
                </div>

                <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border/50 bg-muted/20">
                  <UserAvatar
                    url={currentUser.avatar_url}
                    name={currentUser.name || currentUser.login}
                    className={cn(
                      'h-8 w-8 ring-1 shrink-0',
                      isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                    )}
                    fallbackClassName={cn(
                      'h-8 w-8 bg-primary/10 text-primary font-bold text-xs ring-1 shrink-0',
                      isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs text-foreground truncate">
                      {currentUser.name || currentUser.login}
                      <span className="text-[10px] text-muted-foreground font-normal ml-1">(@{currentUser.login})</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {t('sync_dedicated_repo')}<span className="font-mono text-foreground font-medium">qshell-cloud-backup</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                  <span className="flex items-center gap-1.5 font-mono truncate mr-2 min-w-0">
                    <Lock className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="shrink-0">{t('sync_token_label')}</span>
                    <span className="text-foreground/80 font-mono truncate text-[11px]">
                      {showConnectedToken
                        ? currentToken
                        : (currentToken ? `${currentToken.slice(0, 6)}••••••••${currentToken.slice(-4)}` : '••••••••')}
                    </span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowConnectedToken(!showConnectedToken)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title={showConnectedToken ? t('sync_hide_token') : t('sync_show_token')}
                    >
                      {showConnectedToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentToken, t('sync_label_token'), 'token')}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title={t('sync_copy_token')}
                    >
                      {copiedField === 'token' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-7.5"
                    onClick={() => {
                      setInputToken(currentToken)
                      setIsEditingToken(true)
                    }}
                  >
                    {t('sync_change_token')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7.5 text-destructive hover:bg-destructive/10"
                    onClick={handleClearToken}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('sync_unbind')}
                  </Button>
                </div>
              </div>
            ) : (
              /* ── 未关联或重新配置态 ── */
              <div className="space-y-2.5 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <KeyRound className={cn('h-3.5 w-3.5', isGitee ? 'text-red-500' : 'text-primary')} />
                    <span>{isGitee ? t('sync_token_input_gitee') : t('sync_token_input_github')}</span>
                  </label>
                  <a
                    href={tokenHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                  >
                    {isGitee ? t('sync_gitee_token_btn') : t('sync_github_token_btn')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isGitee ? t('sync_gitee_token_tip') : t('sync_github_token_tip')}
                </p>

                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={inputToken}
                    onChange={(e) => setInputToken(e.target.value)}
                    placeholder={isGitee ? t('sync_gitee_token_ph') : t('sync_github_token_ph')}
                    className="pr-16 text-xs font-mono h-8"
                  />
                  <div className="absolute right-2 top-1.5 flex items-center gap-0.5">
                    {inputToken && (
                      <button
                        type="button"
                        onClick={() => handleCopy(inputToken, t('sync_label_token'), 'token')}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                        title={t('sync_copy_token')}
                      >
                        {copiedField === 'token' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                      title={showToken ? t('sync_hide_token') : t('sync_show_token')}
                    >
                      {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    className={cn('flex-1 text-xs h-7.5', isGitee && 'hover:bg-red-600')}
                    onClick={handleSaveToken}
                    disabled={isVerifying || isSyncing}
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        {t('sync_validating')}
                      </>
                    ) : (
                      t('sync_save_and_bind')
                    )}
                  </Button>
                  {isConfigured && isEditingToken && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7.5"
                      onClick={() => setIsEditingToken(false)}
                    >
                      {t('common_cancel')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 卡片 2: 端到端加密主密码 */}
        <Card className="border-border/60 bg-card/60 flex flex-col justify-between">
          <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
            {masterPassword && !isEditingPassword ? (
              /* ── 已配置锁定态 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{t('sync_master_pwd_title')}</span>
                  </label>
                  <span className="text-[10px] text-emerald-500 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    AES-256-GCM
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <Lock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <span>{t('sync_master_pwd_ready')}</span>
                        <span className="text-[9px] text-emerald-500 font-normal px-1.5 py-0.2 rounded bg-emerald-500/10">{t('sync_master_pwd_safe_badge')}</span>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                        {showPassword ? masterPassword : '••••••••••••'} ({t('sync_master_pwd_chars', { n: masterPassword.length })})
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title={showPassword ? t('sync_master_pwd_hide') : t('sync_master_pwd_show')}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(masterPassword, t('sync_label_master_pwd'), 'password')}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title={t('sync_master_pwd_copy')}
                    >
                      {copiedField === 'password' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span>{t('sync_master_pwd_local_safe')}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{t('sync_master_pwd_never_cloud')}</span>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-7.5"
                    onClick={() => {
                      setInputMasterPassword(masterPassword)
                      setIsEditingPassword(true)
                    }}
                  >
                    {t('sync_master_pwd_change')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7.5 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      clearMasterPassword()
                      setInputMasterPassword('')
                      setIsEditingPassword(true)
                    }}
                  >
                    {t('sync_master_pwd_clear')}
                  </Button>
                </div>
              </div>
            ) : (
              /* ── 输入与编辑态 ── */
              <div className="space-y-2.5 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{t('sync_master_pwd_setup_title')}</span>
                  </label>
                  <span className="text-[10px] text-emerald-500 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    AES-256-GCM
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {t('sync_master_pwd_setup_desc')}
                </p>

                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={inputMasterPassword}
                    onChange={(e) => setInputMasterPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePassword()
                    }}
                    placeholder={t('sync_master_pwd_setup_ph')}
                    className="pr-16 text-xs h-8"
                    autoFocus={isEditingPassword && Boolean(masterPassword)}
                  />
                  <div className="absolute right-2 top-1.5 flex items-center gap-0.5">
                    {inputMasterPassword && (
                      <button
                        type="button"
                        onClick={() => handleCopy(inputMasterPassword, t('sync_label_master_pwd'), 'password')}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                        title={t('sync_master_pwd_copy')}
                      >
                        {copiedField === 'password' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                      title={showPassword ? t('sync_master_pwd_hide') : t('sync_master_pwd_show')}
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    className="flex-1 text-xs h-7.5"
                    onClick={handleSavePassword}
                  >
                    {t('sync_master_pwd_save_btn')}
                  </Button>
                  {masterPassword && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7.5"
                      onClick={() => setIsEditingPassword(false)}
                    >
                      {t('common_cancel')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3. 备份与还原操作台 */}
      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40 pb-3">
            <div>
              <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <CloudUpload className="h-3.5 w-3.5 text-primary" />
                <span>{t('sync_console_title')}</span>
              </h4>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {lastSyncTime ? (
                  <>{t('sync_last_time', { time: new Date(lastSyncTime).toLocaleString(language || 'zh-CN'), platform: isGitee ? 'Gitee' : 'GitHub' })}</>
                ) : (
                  t('sync_never_synced')
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRestore()}
                disabled={!isConfigured || isSyncing}
                className="gap-1.5 text-xs h-8"
              >
                <CloudDownload className="h-3.5 w-3.5" />
                {t('sync_restore_from_cloud')}
              </Button>
              <Button
                size="sm"
                onClick={handleBackup}
                disabled={!isConfigured || isSyncing}
                className={cn(
                  'gap-1.5 text-xs text-white h-8',
                  isGitee
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900',
                )}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('sync_syncing')}
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-3.5 w-3.5" />
                    {t('sync_backup_now', { platform: isGitee ? 'Gitee' : 'GitHub' })}
                  </>
                )}
              </Button>
            </div>
          </div>

          {lastSyncResult && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg p-2.5 text-xs',
                lastSyncResult.success
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20',
              )}
            >
              {lastSyncResult.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              )}
              <span>{lastSyncResult.msg}</span>
            </div>
          )}

          {/* 历史版本快照时间轴 */}
          {historyList.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  {t('sync_history_title')}
                  <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded font-normal">
                    {historyLimit <= 3
                      ? t('sync_history_recent_3')
                      : t('sync_history_showing_count', { count: historyList.length })}
                  </span>
                </span>
                <div className="flex items-center gap-1">
                  {historyLimit > 3 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => void resetHistoryLimit()}
                    >
                      <ChevronUp className="h-3 w-3 mr-1" />
                      {t('sync_history_collapse')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => void fetchHistory()}>
                    {t('sync_refresh_snapshots')}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {historyList.map((item) => (
                  <div
                    key={item.sha}
                    className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-2 px-2.5 text-xs hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-background border border-border/60 text-muted-foreground shrink-0">
                        <GitBranch className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] font-semibold text-foreground flex items-center gap-1.5">
                          <span>{item.sha.substring(0, 7)}</span>
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {item.date ? new Date(item.date).toLocaleString(language || 'zh-CN') : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/80 truncate max-w-[240px] sm:max-w-xs">
                          {item.message}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[11px] hover:text-primary shrink-0 px-2"
                      onClick={() => void handleRestore(item.sha)}
                    >
                      {t('sync_restore_this_snapshot')}
                    </Button>
                  </div>
                ))}

                {/* 加载更多 / 提示 */}
                {hasMoreHistory ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-[11px] border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    disabled={isLoadingMoreHistory}
                    onClick={() => void loadMoreHistory()}
                  >
                    {isLoadingMoreHistory ? (
                      <>
                        <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                        {t('sync_history_loading_more')}
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3 mr-1.5" />
                        {t('sync_history_load_more')}
                      </>
                    )}
                  </Button>
                ) : (
                  historyList.length >= 3 && (
                    <div className="text-center py-1 text-[10px] text-muted-foreground/60">
                      {t('sync_history_no_more')}
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. 自动同步偏好设置 */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-muted/20 text-xs">
        <div className="space-y-0.5 pr-4 min-w-0 flex-1">
          <div className="font-medium text-foreground flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5 text-primary shrink-0", isSyncing && "animate-spin")} />
            <span>{t('sync_auto_sync_title')}</span>
            {isConfigured && masterPassword && (
              <span className={cn(
                "text-[9px] px-1.5 py-0.2 rounded font-normal",
                autoSync ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
              )}>
                {autoSync ? t('sync_auto_sync_badge_enabled') : t('sync_auto_sync_badge_disabled')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t('sync_auto_sync_desc')}
          </p>
        </div>
        <div className="shrink-0 flex items-center">
          <Switch
            checked={autoSync}
            onCheckedChange={(checked) => setAutoSync(checked)}
            disabled={!isConfigured || !masterPassword}
          />
        </div>
      </div>

      {/* 5. 匿名统计偏好设置 (轻量紧凑行) */}
      <div className="flex items-center justify-between p-3 rounded-xl border border-border/50 bg-muted/20 text-xs">
        <div className="space-y-0.5 pr-2">
          <div className="font-medium text-foreground">{t('sync_telemetry_title')}</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {t('sync_telemetry_desc')}
          </p>
        </div>
        <Button
          variant={telemetryActive ? 'default' : 'outline'}
          size="sm"
          onClick={handleToggleTelemetry}
          className="h-7 text-xs shrink-0"
        >
          {telemetryActive ? t('sync_telemetry_enabled') : t('sync_telemetry_disabled')}
        </Button>
      </div>
    </div>
  )
}
