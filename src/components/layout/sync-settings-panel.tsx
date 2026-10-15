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
import { useSyncStore, type SyncProvider } from '@/store/sync-store'
import { useToast } from '@/components/ui/toast'
import { UserAvatar } from '@/components/ui/user-avatar'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function SyncSettingsPanel() {
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
    setProvider,
    setToken,
    clearToken,
    setMasterPassword,
    clearMasterPassword,
    backup,
    restore,
    fetchHistory,
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
      toast.warning(`暂无${label}可复制`)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      toast.success(`${label}已复制到剪贴板`)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {
      toast.error('复制失败，请手动选择复制')
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
    if (!inputToken.trim()) {
      toast.warning(`请输入 ${provider === 'gitee' ? 'Gitee' : 'GitHub'} 访问令牌`)
      return
    }
    setIsVerifying(true)
    const res = await setToken(inputToken)
    setIsVerifying(false)

    if (res.success) {
      setIsEditingToken(false)
      toast.success(`${provider === 'gitee' ? 'Gitee' : 'GitHub'} 令牌验证成功，已成功关联账号！`)
    } else {
      toast.error(`关联失败: ${res.error}`)
    }
  }

  // 解绑 Token
  const handleClearToken = () => {
    clearToken()
    setInputToken('')
    setIsEditingToken(false)
    toast.info('已解除该平台账号绑定')
  }

  // 保存并锁定主密码
  const handleSavePassword = () => {
    const trimmed = inputMasterPassword.trim()
    if (!trimmed) {
      toast.warning('请输入同步主密码以保护您的配置')
      return
    }
    setMasterPassword(trimmed)
    setIsEditingPassword(false)
    toast.success('同步主密码已保存并锁定')
  }

  // 立即备份
  const handleBackup = async () => {
    if (!masterPassword.trim()) {
      toast.warning('请先设置同步主密码，以保护您的服务器敏感资产')
      return
    }
    const res = await backup()
    if (res.success) {
      toast.success(`配置已成功加密并推送到您的 ${provider === 'gitee' ? 'Gitee' : 'GitHub'} 私有仓库！`)
    } else {
      toast.error(`备份失败: ${res.error}`)
    }
  }

  // 从云端恢复
  const handleRestore = async (commitSha?: string) => {
    if (!masterPassword.trim()) {
      toast.warning('请输入同步主密码以解密云端配置')
      return
    }
    const res = await restore(undefined, commitSha)
    if (res.success) {
      const stats = res.stats
      const details: string[] = []
      if (stats?.servers !== undefined) details.push(`${stats.servers} 台服务器`)
      if (stats?.groups) details.push(`${stats.groups} 个分组`)
      if (stats?.sshKeys) details.push(`${stats.sshKeys} 个SSH密钥`)
      if (stats?.tags) details.push(`${stats.tags} 个标签`)
      if (stats?.backgrounds) details.push(`${stats.backgrounds} 个壁纸媒体`)
      const detailStr = details.length > 0 ? `（${details.join('、')}及全量习惯设置）` : ''
      toast.success(`成功从云端恢复配置${detailStr}！`)
    } else {
      toast.error(`恢复失败: ${res.error}`)
    }
  }

  const handleToggleTelemetry = () => {
    const next = !telemetryActive
    setTelemetryActive(next)
    setTelemetryEnabled(next)
    toast.info(next ? '已开启匿名活跃度统计' : '已关闭匿名统计')
  }

  const isGitee = provider === 'gitee'
  const tokenHelpUrl = isGitee
    ? 'https://gitee.com/profile/personal_access_tokens/new'
    : 'https://github.com/settings/tokens/new?scopes=repo&description=Qshell+Cloud+Backup'

  return (
    <div className="space-y-6">
      {/* 1. 顶层场景提示条：消除用户疑惑 */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground/90 shadow-sm leading-relaxed">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-3.5 w-3.5" />
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-foreground flex items-center gap-2">
            <span>关于多设备云同步功能</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-normal">可选配置</span>
          </div>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            如果您仅在当前单台电脑上使用 Qshell，**完全无需配置此功能**，所有数据均保存在本地 SQLite 中；
            当您需要在多台电脑（如公司台式机与出差笔记本）间同步配置，或重装系统防丢时，可绑定 Gitee 或 GitHub 私有仓库进行云端漫游。
            数据在本地经金融级 <span className="text-foreground font-medium">AES-256-GCM 零知识加密</span>，云端仅存储不可逆乱码密文。
          </p>
        </div>
      </div>

      {/* 2. 头部状态总览卡片 + 双引擎分段控制器 */}
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm overflow-hidden">
        <div className="border-b border-border/40 bg-muted/20 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>选择多端同步云存储平台</span>
          </div>

          {/* 切换分段按钮 */}
          <div className="inline-flex rounded-lg border border-border/60 bg-background p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setProvider('gitee')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                isGitee
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="text-sm">🇨🇳</span>
              <span>Gitee (国内极速推荐)</span>
            </button>
            <button
              type="button"
              onClick={() => setProvider('github')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                !isGitee
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>GitHub (全球开发者)</span>
            </button>
          </div>
        </div>

        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border transition-colors',
                  isGitee
                    ? 'bg-red-500/10 border-red-500/20 text-red-500'
                    : 'bg-primary/10 border-primary/20 text-primary',
                )}
              >
                <Cloud className="h-7 w-7" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {isGitee ? 'Gitee 国内极速私有仓同步' : 'GitHub 全球私有仓同步'}
                  </h3>
                  {isConfigured ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-500 border border-emerald-500/20">
                      <CheckCircle2 className="h-3 w-3" />
                      已关联
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground border border-border">
                      未绑定
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {isGitee
                    ? '基于 Gitee 私有仓库，国内 15ms 极速响应，无需代理。加密数据安全托管在您的专属账户中。'
                    : '基于 GitHub 私有仓库，全球开发者标配。端到端零知识加密，无缝跨境漫游。'}
                </p>
              </div>
            </div>

            {isConfigured && currentUser && (
              <div className="flex items-center gap-3 rounded-xl bg-background/60 border border-border/40 p-2.5 px-4 shadow-sm shrink-0">
                <UserAvatar
                  url={currentUser.avatar_url}
                  name={currentUser.name || currentUser.login}
                  className={cn(
                    'h-10 w-10 ring-2 shrink-0',
                    isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                  )}
                  fallbackClassName={cn(
                    'h-10 w-10 bg-primary/10 text-primary font-bold text-sm ring-2 shrink-0',
                    isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                  )}
                />
                <div className="text-left">
                  <div className="text-xs font-medium text-foreground truncate max-w-[120px]">
                    {currentUser.name || currentUser.login}
                  </div>
                  <div className="text-[11px] text-muted-foreground">@{currentUser.login}</div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 3. 凭证与安全配置 (两列紧凑对称卡片) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 卡片 1: 平台访问令牌 / 已关联账号 */}
        <Card className="border-border/60 flex flex-col justify-between">
          <CardContent className="p-5 flex flex-col justify-between h-full space-y-3.5">
            {isConfigured && currentUser && !isEditingToken ? (
              /* ── 已关联状态：对称 4 级紧凑结构 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>{isGitee ? '已关联 Gitee 账号' : '已关联 GitHub 账号'}</span>
                  </span>
                  <span className="text-[11px] font-medium text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    连接就绪
                  </span>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-muted/20">
                  <UserAvatar
                    url={currentUser.avatar_url}
                    name={currentUser.name || currentUser.login}
                    className={cn(
                      'h-10 w-10 ring-2 shrink-0',
                      isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                    )}
                    fallbackClassName={cn(
                      'h-10 w-10 bg-primary/10 text-primary font-bold text-xs ring-2 shrink-0',
                      isGitee ? 'ring-red-500/30' : 'ring-primary/30',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs text-foreground truncate">
                      {currentUser.name || currentUser.login}
                      <span className="text-[10px] text-muted-foreground font-normal ml-1.5">(@{currentUser.login})</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      专属私有仓：<span className="font-mono text-foreground font-medium">qshell-cloud-backup</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                  <span className="flex items-center gap-1.5 font-mono truncate mr-2 min-w-0">
                    <Lock className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="shrink-0">令牌：</span>
                    <span className="text-foreground/80 font-mono truncate">
                      {showConnectedToken
                        ? currentToken
                        : (currentToken ? `${currentToken.slice(0, 6)}••••••••${currentToken.slice(-4)}` : '••••••••')}
                    </span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground mr-1">权限: {isGitee ? 'projects' : 'repo'}</span>
                    <button
                      type="button"
                      onClick={() => setShowConnectedToken(!showConnectedToken)}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title={showConnectedToken ? '隐藏令牌' : '查看完整令牌'}
                    >
                      {showConnectedToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentToken, `${isGitee ? 'Gitee' : 'GitHub'} 访问令牌`, 'token')}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                      title="复制令牌"
                    >
                      {copiedField === 'token' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8"
                    onClick={() => {
                      setInputToken(currentToken)
                      setIsEditingToken(true)
                    }}
                  >
                    更换访问令牌
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 text-destructive hover:bg-destructive/10"
                    onClick={handleClearToken}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    解除绑定
                  </Button>
                </div>
              </div>
            ) : (
              /* ── 未关联或重新配置态 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <KeyRound className={cn('h-4 w-4', isGitee ? 'text-red-500' : 'text-primary')} />
                    <span>{isGitee ? 'Gitee 私人令牌 (Token)' : 'GitHub 访问令牌 (Token)'}</span>
                  </label>
                  <a
                    href={tokenHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
                  >
                    {isGitee ? '生成私人令牌' : '一键直达预选权限'}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isGitee ? (
                    <>在 Gitee 中生成 Token 时，仅需勾选 <span className="text-foreground font-mono bg-muted px-1 rounded">projects</span> 权限即可。</>
                  ) : (
                    <>点击右上方直达 GitHub，已为您自动预选 <span className="text-foreground font-mono bg-muted px-1 rounded">repo</span> 私有仓权限。</>
                  )}
                </p>

                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={inputToken}
                    onChange={(e) => setInputToken(e.target.value)}
                    placeholder={isGitee ? '粘贴 Gitee 私人访问令牌...' : '粘贴 GitHub Personal Access Token (ghp_...)...'}
                    className="pr-16 text-xs font-mono"
                  />
                  <div className="absolute right-2.5 top-2 flex items-center gap-1">
                    {inputToken && (
                      <button
                        type="button"
                        onClick={() => handleCopy(inputToken, `${isGitee ? 'Gitee' : 'GitHub'} 访问令牌`, 'token')}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                        title="复制令牌"
                      >
                        {copiedField === 'token' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                      title={showToken ? '隐藏令牌' : '显示令牌'}
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    className={cn('flex-1 text-xs h-8', isGitee && 'hover:bg-red-600')}
                    onClick={handleSaveToken}
                    disabled={isVerifying || isSyncing}
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        验证中...
                      </>
                    ) : (
                      '保存并关联'
                    )}
                  </Button>
                  {isConfigured && isEditingToken && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={() => setIsEditingToken(false)}
                    >
                      取消
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 卡片 2: 端到端加密主密码 */}
        <Card className="border-border/60 flex flex-col justify-between">
          <CardContent className="p-5 flex flex-col justify-between h-full space-y-3.5">
            {masterPassword && !isEditingPassword ? (
              /* ── 已配置锁定态：对称 4 级紧凑结构 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>同步主密码 (E2EE 密钥)</span>
                  </label>
                  <span className="text-[11px] text-emerald-500 font-medium bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    AES-256-GCM 保护
                  </span>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-muted/20">
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
                    <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center justify-center shrink-0">
                      <Lock className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <span>主密码已锁定就绪</span>
                        <span className="text-[10px] text-emerald-500 font-normal px-1.5 py-0.2 rounded bg-emerald-500/10">防误触保护</span>
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate">
                        {showPassword ? masterPassword : '••••••••••••'} ({masterPassword.length} 位字符)
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                      title={showPassword ? '隐藏密码' : '查看密码'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(masterPassword, '同步主密码', 'password')}
                      className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
                      title="复制主密码"
                    >
                      {copiedField === 'password' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span>已安全保存在本机，下次免密同步</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">绝不上云</span>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8"
                    onClick={() => {
                      setInputMasterPassword(masterPassword)
                      setIsEditingPassword(true)
                    }}
                  >
                    修改主密码
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      clearMasterPassword()
                      setInputMasterPassword('')
                      setIsEditingPassword(true)
                    }}
                  >
                    清除重设
                  </Button>
                </div>
              </div>
            ) : (
              /* ── 输入与编辑态 ── */
              <div className="space-y-3 flex flex-col justify-between h-full">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>设置同步主密码</span>
                  </label>
                  <span className="text-[11px] text-emerald-500 font-medium bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    AES-256-GCM 保护
                  </span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  在本地加解密服务器密码与私钥，换电脑时输入相同主密码即可一键还原。
                </p>

                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={inputMasterPassword}
                    onChange={(e) => setInputMasterPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSavePassword()
                    }}
                    placeholder="设置同步主密码（两端通用，请牢记）..."
                    className="pr-16 text-xs"
                    autoFocus={isEditingPassword && Boolean(masterPassword)}
                  />
                  <div className="absolute right-2.5 top-2 flex items-center gap-1">
                    {inputMasterPassword && (
                      <button
                        type="button"
                        onClick={() => handleCopy(inputMasterPassword, '同步主密码', 'password')}
                        className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                        title="复制主密码"
                      >
                        {copiedField === 'password' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
                      title={showPassword ? '隐藏密码' : '显示密码'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 mt-auto">
                  <Button
                    size="sm"
                    className="flex-1 text-xs h-8"
                    onClick={handleSavePassword}
                  >
                    保存并锁定密码
                  </Button>
                  {masterPassword && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-8"
                      onClick={() => setIsEditingPassword(false)}
                    >
                      取消
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4. 备份与还原操作台 */}
      <Card className="border-border/60">
        <CardContent className="p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
            <div>
              <h4 className="text-sm font-semibold text-foreground">云端备份与还原控制台</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lastSyncTime ? (
                  <>上次同步时间：{new Date(lastSyncTime).toLocaleString('zh-CN')} ({isGitee ? 'Gitee' : 'GitHub'})</>
                ) : (
                  '尚未在该平台进行过云端同步'
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRestore()}
                disabled={!isConfigured || isSyncing}
                className="gap-2 text-xs"
              >
                <CloudDownload className="h-4 w-4" />
                从云端恢复
              </Button>
              <Button
                size="sm"
                onClick={handleBackup}
                disabled={!isConfigured || isSyncing}
                className={cn(
                  'gap-2 text-xs text-white',
                  isGitee
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900',
                )}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在同步...
                  </>
                ) : (
                  <>
                    <CloudUpload className="h-4 w-4" />
                    立即备份到 {isGitee ? 'Gitee' : 'GitHub'}
                  </>
                )}
              </Button>
            </div>
          </div>

          {lastSyncResult && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg p-3 text-xs',
                lastSyncResult.success
                  ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                  : 'bg-destructive/10 text-destructive border border-destructive/20',
              )}
            >
              {lastSyncResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{lastSyncResult.msg}</span>
            </div>
          )}

          {/* 历史版本快照时间轴 */}
          {historyList.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5 text-muted-foreground" />
                  历史备份快照（原生 Git Commit，支持一键版本回滚）
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => void fetchHistory()}>
                  刷新快照
                </Button>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {historyList.map((item) => (
                  <div
                    key={item.sha}
                    className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-2.5 px-3 text-xs hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-background border border-border/60 text-muted-foreground">
                        <GitBranch className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-mono text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                          <span>{item.sha.substring(0, 7)}</span>
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {item.date ? new Date(item.date).toLocaleString('zh-CN') : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground/80 truncate max-w-[280px] sm:max-w-md">
                          {item.message}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs hover:text-primary shrink-0"
                      onClick={() => void handleRestore(item.sha)}
                    >
                      还原此快照
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. 匿名统计偏好设置 */}
      <Card className="border-border/60">
        <CardContent className="p-5 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-foreground">匿名活跃度统计 (Telemetry)</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              仅上报匿名机器随机码与版本号（不包含任何服务器配置、密码或命令行隐私），帮助开发者统计软件活跃装机量。
            </p>
          </div>
          <Button
            variant={telemetryActive ? 'default' : 'outline'}
            size="sm"
            onClick={handleToggleTelemetry}
            className="shrink-0"
          >
            {telemetryActive ? '已启用' : '已关闭'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
