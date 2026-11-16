// RDP 远程桌面模块
//
// 调用系统 RDP 客户端（mstsc/xfreerdp）启动远程桌面会话。
// 独立于 SSH 连接，无需先建立 SSH 连接即可使用。
//
// 设计：
// - 居中卡片布局，显示服务器信息 + 分辨率/端口/颜色深度配置
// - 启动后系统 RDP 客户端弹窗，由用户输入密码（凭据安全）

import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import type { RdpAdvancedOptions } from '@/types'
import { Button } from '@/components/ui/button'
import { QshellLoader } from '@/components/ui/qshell-loader'
import {
  Monitor,
  Play,
  AlertCircle,
  CheckCircle2,
  Maximize2,
  Globe,
  SlidersHorizontal,
  ChevronDown,
  Save,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SelectPopover } from '@/components/ui/select-popover'
import { playSound, SoundType } from '@/lib/sound'

interface RdpViewerModuleProps {
  serverId: string
}

// 预设分辨率
const PRESET_RESOLUTIONS = [
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '2560 × 1440', w: 2560, h: 1440 },
  { label: '3840 × 2160', w: 3840, h: 2160 },
]

const COLOR_DEPTHS = [16, 24, 32]

function parseRdpConfig(raw?: string | null): RdpAdvancedOptions {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as RdpAdvancedOptions) : {}
  } catch {
    return {}
  }
}

export function RdpViewerModule({ serverId }: RdpViewerModuleProps) {
  const { t } = useTranslation()
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId))
  const updateServer = useAppStore((s) => s.updateServer)

  const parsedSaved = useMemo(() => parseRdpConfig(server?.rdpConfig), [server?.rdpConfig])

  const savedEffectivePort =
    parsedSaved.rdpPort && parsedSaved.rdpPort > 0 && parsedSaved.rdpPort <= 65535
      ? parsedSaved.rdpPort
      : server?.rdpPort && server.rdpPort > 0 && server.rdpPort <= 65535
        ? server.rdpPort
        : 0

  const [resolutionIdx, setResolutionIdx] = useState(1) // 默认 1920×1080
  const [fullscreen, setFullscreen] = useState(false)
  const [rdpPortInput, setRdpPortInput] = useState<string>(() =>
    String(savedEffectivePort > 0 ? savedEffectivePort : 3389),
  )
  const [colorDepth, setColorDepth] = useState(32)
  const [useMultimon, setUseMultimon] = useState(false)
  const [redirectClipboard, setRedirectClipboard] = useState(true)
  const [redirectDrives, setRedirectDrives] = useState(false)
  const [redirectPrinters, setRedirectPrinters] = useState(false)
  const [smartSizing, setSmartSizing] = useState(true)
  const [enableCredssp, setEnableCredssp] = useState(true)
  const [audioMode, setAudioMode] = useState<0 | 1 | 2>(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    const matchIdx = PRESET_RESOLUTIONS.findIndex(
      (r) => r.w === parsedSaved.width && r.h === parsedSaved.height
    )
    setResolutionIdx(matchIdx >= 0 ? matchIdx : 1)
    setFullscreen(Boolean(parsedSaved.fullscreen))
    setRdpPortInput(String(savedEffectivePort > 0 ? savedEffectivePort : 3389))
    setColorDepth(parsedSaved.colorDepth || 32)
    setUseMultimon(Boolean(parsedSaved.useMultimon))
    setRedirectClipboard(parsedSaved.redirectClipboard ?? true)
    setRedirectDrives(Boolean(parsedSaved.redirectDrives))
    setRedirectPrinters(Boolean(parsedSaved.redirectPrinters))
    setSmartSizing(parsedSaved.smartSizing ?? true)
    setEnableCredssp(parsedSaved.enableCredssp ?? true)
    setAudioMode(
      parsedSaved.audioMode === 1 || parsedSaved.audioMode === 2 ? parsedSaved.audioMode : 0
    )
  }, [serverId, savedEffectivePort, parsedSaved])

  const trimmedPortInput = rdpPortInput.trim()
  const parsedDraftPort = trimmedPortInput === '' ? 3389 : Number(trimmedPortInput)
  const isPortValid =
    Number.isInteger(parsedDraftPort) && parsedDraftPort >= 1 && parsedDraftPort <= 65535
  const effectivePort = isPortValid ? parsedDraftPort : 3389

  const buildCurrentOptions = (portOverride = effectivePort): RdpAdvancedOptions => {
    const preset = PRESET_RESOLUTIONS[resolutionIdx]
    return {
      rdpPort: portOverride,
      width: preset.w,
      height: preset.h,
      fullscreen,
      colorDepth,
      useMultimon,
      redirectClipboard,
      redirectDrives,
      redirectPrinters,
      smartSizing,
      enableCredssp,
      audioMode,
    }
  }

  const handleSaveConfig = async () => {
    if (!server || !isPortValid) return
    if (trimmedPortInput === '') {
      setRdpPortInput('3389')
    }
    setSaving(true)
    try {
      const serialized = JSON.stringify(buildCurrentOptions(effectivePort))
      const res = await sshService.updateServer(server.id, {
        rdpPort: effectivePort,
        rdpConfig: serialized,
      })
      if (res.success) {
        updateServer(server.id, {
          rdpPort: effectivePort,
          rdpConfig: serialized,
        })
        setLaunchMsg({ ok: true, msg: t('rdp_config_saved') })
      } else {
        setLaunchMsg({ ok: false, msg: res.error || t('rdp_launch_failed') })
      }
    } catch (e) {
      setLaunchMsg({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  const handleLaunch = async () => {
    if (!backend) return
    if (!isPortValid || effectivePort <= 0) {
      setLaunchMsg({ ok: false, msg: t('server_no_rdp_port') || '未配置 RDP 端口' })
      return
    }
    if (trimmedPortInput === '') {
      setRdpPortInput('3389')
    }
    setLaunching(true)
    setLaunchMsg(null)
    try {
      const currentOptions = buildCurrentOptions(effectivePort)
      const preset = PRESET_RESOLUTIONS[resolutionIdx]
      const result = await backend.rdp.launch({
        serverId,
        rdpPort: effectivePort,
        width: fullscreen ? undefined : preset.w,
        height: fullscreen ? undefined : preset.h,
        fullscreen,
        colorDepth,
        options: currentOptions,
      })
      if (result?.success) {
        setLaunchMsg({ ok: true, msg: t('rdp_launched') })
      } else {
        setLaunchMsg({ ok: false, msg: result?.error || t('rdp_launch_failed') })
      }
    } catch (e) {
      setLaunchMsg({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setLaunching(false)
    }
  }

  if (!server) return null

  return (
    <div className="h-full overflow-auto flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* 头部图标 + 标题 */}
        <div className="flex flex-col items-center mb-8">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 flex items-center justify-center mb-4 ring-1 ring-blue-500/30">
            <Monitor className="h-10 w-10 text-blue-500" />
          </div>
          <h2 className="text-lg font-semibold">{t('module_rdp')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('rdp_subtitle')}</p>
        </div>

        {/* 未配置 RDP 端口提示 */}
        {savedEffectivePort <= 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 p-2.5 mb-4 text-xs">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{t('rdp_port_not_configured_hint')}</span>
          </div>
        )}

        {/* 服务器信息卡片 */}
        <div className="rounded-xl border border-border/60 bg-card/50 p-4 mb-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('db_host')}</span>
            <span className="text-sm font-medium font-mono">{server.host}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('rdp_port_label')}</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={rdpPortInput}
              onChange={(e) => setRdpPortInput(e.target.value)}
              onBlur={() => {
                if (!rdpPortInput.trim()) {
                  setRdpPortInput('3389')
                }
              }}
              className="w-24 rounded-md border border-border/60 bg-background px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('db_username')}</span>
            <span className="text-sm font-medium font-mono">{server.username || '—'}</span>
          </div>
        </div>

        {/* 分辨率选择 */}
        <div className="mb-5">
          <label className="text-xs font-medium text-muted-foreground mb-2 block">{t('rdp_resolution')}</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_RESOLUTIONS.map((r, idx) => (
              <button
                key={r.label}
                type="button"
                disabled={fullscreen}
                onClick={() => setResolutionIdx(idx)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs transition-all',
                  fullscreen
                    ? 'opacity-40 cursor-not-allowed border-border/40'
                    : resolutionIdx === idx
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border/60 hover:border-primary/50 hover:bg-accent/40'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* 全屏 + 颜色深度 */}
        <div className="flex items-center gap-4 mb-4">
          <button
            type="button"
            onClick={() => { setFullscreen((v) => !v); playSound(SoundType.Toggle) }}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all flex-1',
              fullscreen
                ? 'border-primary bg-primary/10 text-primary font-medium'
                : 'border-border/60 hover:border-primary/50 hover:bg-accent/40'
            )}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {t('rdp_fullscreen')}
          </button>

          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 flex-1">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <SelectPopover
              value={String(colorDepth)}
              onChange={(v) => setColorDepth(Number(v))}
              options={COLOR_DEPTHS.map((d) => ({ value: String(d), label: `${d} bit` }))}
              className="flex-1 border-0 bg-transparent"
              ariaLabel={t('rdp_color_depth')}
            />
          </div>
        </div>

        {/* 高级重定向与安全折叠区 */}
        <div className="mb-5 rounded-xl border border-border/60 bg-card/40 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('rdp_advanced_options')}
            </span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', showAdvanced && 'rotate-180')}
            />
          </button>

          {showAdvanced && (
            <div className="px-3.5 pb-3.5 pt-2 border-t border-border/50 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'clipboard', label: t('rdp_redirect_clipboard'), value: redirectClipboard, set: setRedirectClipboard },
                  { key: 'drives', label: t('rdp_redirect_drives'), value: redirectDrives, set: setRedirectDrives },
                  { key: 'printers', label: t('rdp_redirect_printers'), value: redirectPrinters, set: setRedirectPrinters },
                  { key: 'multimon', label: t('rdp_use_multimon'), value: useMultimon, set: setUseMultimon },
                  { key: 'smartSizing', label: t('rdp_smart_sizing'), value: smartSizing, set: setSmartSizing },
                  { key: 'credssp', label: t('rdp_enable_credssp'), value: enableCredssp, set: setEnableCredssp },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      item.set((v) => !v)
                      playSound(SoundType.Toggle)
                    }}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] transition-all text-left',
                      item.value
                        ? 'border-primary/60 bg-primary/10 text-primary font-medium'
                        : 'border-border/50 text-muted-foreground hover:border-border'
                    )}
                  >
                    <span className="truncate pr-2">{item.label}</span>
                    <span className="text-[10px] opacity-80">{item.value ? 'ON' : 'OFF'}</span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-xs text-muted-foreground">{t('rdp_audio_mode')}</span>
                <SelectPopover
                  value={String(audioMode)}
                  onChange={(v) => setAudioMode(Number(v) as 0 | 1 | 2)}
                  options={[
                    { value: '0', label: t('rdp_audio_local') },
                    { value: '1', label: t('rdp_audio_remote') },
                    { value: '2', label: t('rdp_audio_disabled') },
                  ]}
                  className="w-40"
                  ariaLabel={t('rdp_audio_mode')}
                />
              </div>
            </div>
          )}
        </div>

        {/* 启动与保存按钮 */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveConfig}
            disabled={saving || !isPortValid}
            className="h-11 gap-1.5 px-4 text-xs"
            title={t('rdp_save_config')}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '...' : t('rdp_save_config')}
          </Button>
          <Button
            onClick={handleLaunch}
            disabled={launching || !isPortValid}
            className="flex-1 h-11 gap-2 text-sm"
            size="lg"
          >
            {launching ? (
              <><QshellLoader size="xs" /> {t('rdp_launching')}</>
            ) : (
              <><Play className="h-4 w-4" /> {t('rdp_btn_launch')}</>
            )}
          </Button>
        </div>

        {/* 启动结果提示 */}
        {launchMsg && (
          <div
            className={cn(
              'mt-4 flex items-start gap-2 rounded-lg p-3 text-xs',
              launchMsg.ok
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-destructive/10 text-destructive'
            )}
          >
            {launchMsg.ok ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p>{launchMsg.msg}</p>
              {launchMsg.ok && (
                <p className="mt-1 opacity-80">{t('rdp_credential_hint')}</p>
              )}
            </div>
          </div>
        )}

        {/* 底部说明 */}
        <p className="mt-6 text-center text-[11px] text-muted-foreground/70 leading-relaxed">
          {t('rdp_system_client_hint')}
        </p>
      </div>
    </div>
  )
}
