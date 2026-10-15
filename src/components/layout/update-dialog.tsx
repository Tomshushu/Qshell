import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useUpdaterStore } from '@/store/updater-store'
import { isTauri } from '@/services/api'

const openExternalUrl = async (url: string) => {
  try {
    if (isTauri) {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } else {
      window.open(url, '_blank')
    }
  } catch {
    window.open(url, '_blank')
  }
}
import {
  Sparkles,
  Download,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  Activity,
} from 'lucide-react'
import type { UpdaterMirrorsReport, PreferredMirror } from '@/store/updater-store'
import { useTranslation } from '@/i18n'

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function MirrorStatusCard({
  report,
  preferredMirror,
  setPreferredMirror,
  onRefresh,
}: {
  report: UpdaterMirrorsReport | null
  preferredMirror: PreferredMirror
  setPreferredMirror: (mirror: PreferredMirror) => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  if (!report) return null

  return (
    <div className="p-2.5 rounded-xl border border-border/70 bg-muted/20 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Activity className="h-3.5 w-3.5 text-primary" />
          <span>{t('ota_mirror_speed_channel')}</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span className="text-[10px] text-muted-foreground/80">{t('ota_channel_label')}</span>
          {(['auto', 'gitee', 'github'] as const).map((m) => {
            const label = m === 'auto' ? t('ota_channel_auto') : m === 'gitee' ? 'Gitee' : 'GitHub'
            const active = preferredMirror === m
            return (
              <button
                key={m}
                type="button"
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                    : 'hover:bg-accent text-muted-foreground'
                }`}
                onClick={() => {
                  setPreferredMirror(m)
                  onRefresh()
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-0.5">
        {/* Gitee 节点 */}
        <div
          className={`flex items-center justify-between p-2 rounded-lg border text-[11px] transition-all ${
            report.preferred === 'gitee'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground font-medium shadow-2xs'
              : 'border-border/60 bg-background/50 text-muted-foreground'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate">{t('ota_mirror_gitee')}</span>
            {report.preferred === 'gitee' && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500 text-white font-bold shrink-0">
                {t('ota_mirror_preferred')}
              </span>
            )}
          </div>
          <span className="font-mono text-[10px] shrink-0">
            {report.gitee.available ? `${report.gitee.latencyMs}ms` : t('ota_mirror_offline')}
          </span>
        </div>

        {/* GitHub 节点 */}
        <div
          className={`flex items-center justify-between p-2 rounded-lg border text-[11px] transition-all ${
            report.preferred === 'github'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground font-medium shadow-2xs'
              : 'border-border/60 bg-background/50 text-muted-foreground'
          }`}
        >
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate">{t('ota_mirror_github')}</span>
            {report.preferred === 'github' && (
              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500 text-white font-bold shrink-0">
                {t('ota_mirror_preferred')}
              </span>
            )}
          </div>
          <span className="font-mono text-[10px] shrink-0">
            {report.github.available ? `${report.github.latencyMs}ms` : t('ota_mirror_timeout')}
          </span>
        </div>
      </div>
    </div>
  )
}

export function UpdateDialog() {
  const { t } = useTranslation()
  const {
    isDialogOpen,
    closeDialog,
    isChecking,
    updateAvailable,
    updateInfo,
    isDownloading,
    downloadProgress,
    isReadyToRelaunch,
    errorMessage,
    checkForUpdates,
    downloadAndInstall,
    relaunchApp,
    skipVersion,
    preferredMirror,
    mirrorReport,
    setPreferredMirror,
  } = useUpdaterStore()

  return (
    <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="max-w-[480px] max-h-[min(90vh,680px)] flex flex-col p-0 overflow-hidden bg-card/98 backdrop-blur-2xl border border-border/70 rounded-2xl shadow-2xl">
        {/* 顶部环境装饰光晕 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 bg-primary/10 blur-3xl pointer-events-none rounded-full" />

        <div className="p-6 space-y-5 overflow-y-auto max-h-[min(90vh,680px)] [scrollbar-gutter:stable] min-w-0">
          {/* 弹窗头部 */}
          <DialogHeader className="text-left space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shadow-xs">
                {isReadyToRelaunch ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : errorMessage ? (
                  <AlertCircle className="h-5 w-5 text-destructive" />
                ) : updateAvailable ? (
                  <Sparkles className="h-5 w-5 text-primary" />
                ) : (
                  <RotateCw className={`h-5 w-5 ${isChecking ? 'animate-spin' : ''}`} />
                )}
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  {isReadyToRelaunch
                    ? t('ota_ready_relaunch_title')
                    : errorMessage
                    ? (updateAvailable ? t('ota_download_error_title') : t('ota_check_error_title'))
                    : updateAvailable
                    ? t('ota_found_new_version', { version: updateInfo?.version ?? '' })
                    : isChecking
                    ? t('ota_checking_title')
                    : t('ota_latest_title')}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {isReadyToRelaunch
                    ? t('ota_ready_desc')
                    : errorMessage
                    ? (updateAvailable ? t('ota_download_failed_desc') : t('ota_check_failed_desc'))
                    : updateAvailable
                    ? t('ota_found_desc')
                    : isChecking
                    ? t('ota_connecting_desc')
                    : t('ota_latest_desc')}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* 状态 1: 正在检查 */}
          {isChecking && (
            <div className="py-8 text-center space-y-3">
              <RotateCw className="h-8 w-8 text-primary animate-spin mx-auto" />
              <p className="text-xs text-muted-foreground">{t('ota_checking_signatures')}</p>
            </div>
          )}

          {/* 状态 2: 遇到错误 */}
          {!isChecking && errorMessage && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-destructive/20 bg-destructive/10 text-xs space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div className="space-y-1.5 text-left flex-1 min-w-0">
                    <p className="font-semibold text-destructive">
                      {updateAvailable ? t('ota_download_error_title') : t('ota_check_failed')}
                    </p>
                    <div className="max-h-36 overflow-y-auto rounded-lg bg-background/60 p-2.5 border border-destructive/15">
                      <p className="text-muted-foreground text-[11px] leading-relaxed font-mono break-all [overflow-wrap:anywhere] whitespace-pre-wrap select-text">
                        {errorMessage}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 节点测速状态与通道选择 */}
              <MirrorStatusCard
                report={mirrorReport}
                preferredMirror={preferredMirror}
                setPreferredMirror={setPreferredMirror}
                onRefresh={() => void checkForUpdates(false)}
              />

              {/* 备用直链下载 */}
              <div className="p-3 rounded-xl border border-border/80 bg-muted/30 space-y-2 text-xs">
                <p className="font-medium text-foreground flex items-center gap-1.5 text-[11px]">
                  <ExternalLink className="h-3.5 w-3.5 text-primary" />
                  {t('ota_browser_download_hint')}
                </p>
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px] gap-1.5 bg-background hover:bg-accent text-foreground"
                    onClick={() => void openExternalUrl('https://gitee.com/Tom-shushu/qshell/releases')}
                  >
                    <span>{t('ota_btn_gitee_mirror')}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-[11px] gap-1.5 bg-background hover:bg-accent text-foreground"
                    onClick={() => void openExternalUrl('https://github.com/Tomshushu/Qshell/releases')}
                  >
                    <span>{t('ota_btn_github_release')}</span>
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-xs h-8.5" onClick={closeDialog}>
                  {t('common_close')}
                </Button>
                <Button
                  size="sm"
                  className="text-xs h-8.5 gap-1.5"
                  onClick={() => {
                    if (updateAvailable) {
                      void downloadAndInstall()
                    } else {
                      void checkForUpdates(false)
                    }
                  }}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  {t('common_retry')}
                </Button>
              </div>
            </div>
          )}

          {/* 状态 3: 已是最新版本 */}
          {!isChecking && !errorMessage && !updateAvailable && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-foreground">{t('ota_up_to_date_title')}</p>
                  <p className="text-xs text-muted-foreground">{t('ota_up_to_date_desc')}</p>
                </div>
              </div>

              {/* 节点测速状态与通道选择 */}
              <MirrorStatusCard
                report={mirrorReport}
                preferredMirror={preferredMirror}
                setPreferredMirror={setPreferredMirror}
                onRefresh={() => void checkForUpdates(false)}
              />

              <div className="flex justify-end pt-1">
                <Button size="sm" className="text-xs h-8.5 px-5" onClick={closeDialog}>
                  {t('ota_got_it')}
                </Button>
              </div>
            </div>
          )}

          {/* 状态 4: 发现新版本 */}
          {!isChecking && !errorMessage && updateAvailable && updateInfo && (
            <div className="space-y-4">
              {/* 版本跨度与安全认证条 */}
              <div className="p-3 rounded-xl border border-border/70 bg-muted/30 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">v{updateInfo.currentVersion}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono font-bold text-primary">v{updateInfo.version}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>{t('ota_signed_badge')}</span>
                </div>
              </div>

              {/* 节点测速状态与通道选择 */}
              <MirrorStatusCard
                report={mirrorReport}
                preferredMirror={preferredMirror}
                setPreferredMirror={setPreferredMirror}
                onRefresh={() => void checkForUpdates(false)}
              />

              {/* 更新日志详情 */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">{t('ota_changelog')}</label>
                <div className="max-h-48 overflow-y-auto p-3 rounded-xl border border-border/60 bg-muted/20 text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed font-sans select-text">
                  {updateInfo.body?.trim() || t('ota_default_changelog')}
                </div>
              </div>

              {/* 下载中进度 */}
              {isDownloading && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5 text-primary animate-bounce" />
                      {t('ota_downloading')}
                    </span>
                    <span className="font-mono font-semibold text-foreground">
                      {downloadProgress.percentage}%
                    </span>
                  </div>
                  <Progress value={downloadProgress.percentage} className="h-2 rounded-full" />
                  <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                    <span>{formatBytes(downloadProgress.downloaded)}</span>
                    <span>{formatBytes(downloadProgress.total)}</span>
                  </div>
                </div>
              )}

              {/* 更新已就绪提示 */}
              {isReadyToRelaunch && (
                <div className="p-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-xs text-emerald-500 flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{t('ota_ready_notice')}</span>
                </div>
              )}

              {/* 操作按钮区 */}
              <div className="flex items-center justify-between gap-2.5 pt-2 border-t border-border/40">
                {!isReadyToRelaunch ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-9 text-muted-foreground hover:text-destructive px-2 font-normal"
                      disabled={isDownloading}
                      onClick={() => {
                        if (updateInfo?.version) {
                          skipVersion(updateInfo.version)
                        } else {
                          closeDialog()
                        }
                      }}
                    >
                      {t('ota_skip_version')}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-9 text-muted-foreground hover:text-foreground"
                        disabled={isDownloading}
                        onClick={closeDialog}
                      >
                        {t('ota_remind_later')}
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs h-9 px-4 font-semibold gap-1.5 shadow-md bg-primary text-primary-foreground hover:bg-primary/95"
                        disabled={isDownloading}
                        onClick={() => void downloadAndInstall()}
                      >
                        {isDownloading ? (
                          <>
                            <RotateCw className="h-3.5 w-3.5 animate-spin" />
                            {t('ota_downloading_pct', { percentage: downloadProgress.percentage })}
                          </>
                        ) : (
                          <>
                            <Download className="h-3.5 w-3.5" />
                            {t('ota_update_now')}
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="w-full text-xs h-9.5 font-semibold gap-1.5 shadow-md bg-emerald-500 hover:bg-emerald-600 text-white"
                    onClick={() => void relaunchApp()}
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    {t('ota_restart_now')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
