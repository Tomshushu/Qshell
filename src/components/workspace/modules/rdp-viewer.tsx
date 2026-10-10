// RDP 远程桌面模块
//
// 调用系统 RDP 客户端（mstsc/xfreerdp）启动远程桌面会话。
// 独立于 SSH 连接，无需先建立 SSH 连接即可使用。
//
// 设计：
// - 居中卡片布局，显示服务器信息 + 分辨率/端口/颜色深度配置
// - 启动后系统 RDP 客户端弹窗，由用户输入密码（凭据安全）

import { useState } from 'react'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { useTranslation } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Monitor, Loader2, Play, AlertCircle, CheckCircle2, Maximize2, Globe } from 'lucide-react'
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

export function RdpViewerModule({ serverId }: RdpViewerModuleProps) {
  const { t } = useTranslation()
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId))

  const [resolutionIdx, setResolutionIdx] = useState(1) // 默认 1920×1080
  const [fullscreen, setFullscreen] = useState(false)
  const [rdpPort, setRdpPort] = useState(server?.rdpPort || 3389)
  const [colorDepth, setColorDepth] = useState(32)
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleLaunch = async () => {
    if (!backend) return
    if (!rdpPort || rdpPort <= 0) {
      setLaunchMsg({ ok: false, msg: t('server_no_rdp_port') || '未配置 RDP 端口' })
      return
    }
    setLaunching(true)
    setLaunchMsg(null)
    try {
      const preset = PRESET_RESOLUTIONS[resolutionIdx]
      const result = await backend.rdp.launch({
        serverId,
        rdpPort,
        width: fullscreen ? undefined : preset.w,
        height: fullscreen ? undefined : preset.h,
        fullscreen,
        colorDepth,
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
        {(!server.rdpPort || server.rdpPort <= 0) && (
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
              value={rdpPort}
              onChange={(e) => setRdpPort(Number(e.target.value) || 3389)}
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
        <div className="flex items-center gap-4 mb-6">
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

        {/* 启动按钮 */}
        <Button
          onClick={handleLaunch}
          disabled={launching || rdpPort < 1 || rdpPort > 65535}
          className="w-full h-11 gap-2 text-sm"
          size="lg"
        >
          {launching ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t('rdp_launching')}</>
          ) : (
            <><Play className="h-4 w-4" /> {t('rdp_btn_launch')}</>
          )}
        </Button>

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
