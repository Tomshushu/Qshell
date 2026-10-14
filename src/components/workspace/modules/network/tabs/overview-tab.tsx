import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Network,
  Globe,
  Radio,
  Server,
  ArrowDownUp,
  ShieldCheck,
  Play,
  History,
  Activity,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { NetOverview, InterfaceInfo } from '@/types/network'

interface OverviewTabProps {
  overview: NetOverview | null
  loading: boolean
  onStartQuickCheck: (target: string, port: number) => void
  onNavigateTab: (tabId: string) => void
}

export function OverviewTab({
  overview,
  onStartQuickCheck,
  onNavigateTab,
}: OverviewTabProps) {
  const { t } = useTranslation()
  const [quickTarget, setQuickTarget] = useState('')
  const [quickPort, setQuickPort] = useState('443')

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickTarget.trim()) return
    const portNum = parseInt(quickPort, 10) || 80
    onStartQuickCheck(quickTarget.trim(), portNum)
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto p-4 space-y-4">
      {/* Top Banner: Quick 6-Layer Diagnosis Launcher */}
      <Card className="bg-gradient-to-r from-primary/10 via-background to-accent/20 border-primary/20 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm">{t('net_ov_quick_check')}</h3>
                <Badge variant="outline" className="text-[10px] bg-background font-mono">
                  6-Layer
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('net_ov_quick_desc')}
              </p>
            </div>

            <form onSubmit={handleQuickSubmit} className="flex items-center gap-2 w-full md:w-auto">
              <Input
                placeholder={t('net_input_placeholder')}
                value={quickTarget}
                onChange={(e) => setQuickTarget(e.target.value)}
                className="h-8 text-xs w-48 md:w-56"
              />
              <Input
                placeholder={t('net_port_placeholder')}
                value={quickPort}
                onChange={(e) => setQuickPort(e.target.value)}
                className="h-8 text-xs w-16"
              />
              <Button type="submit" size="sm" className="h-8 text-xs gap-1.5 shrink-0" disabled={!quickTarget.trim()}>
                <Play className="h-3.5 w-3.5 fill-current" />
                {t('net_start')}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => onNavigateTab('interfaces')}>
          <CardContent className="p-3.5 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground font-medium">{t('net_ov_interfaces')}</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {overview?.interfaces.length ?? 0}
              </div>
              <div className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                {overview?.interfaces.filter(i => i.state === 'UP').length ?? 0} UP
              </div>
            </div>
            <Network className="h-7 w-7 text-primary/30" />
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => onNavigateTab('routes-dns')}>
          <CardContent className="p-3.5 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0 flex-1 pr-2">
              <div className="text-xs text-muted-foreground font-medium">{t('net_ov_default_route')}</div>
              <div className="text-sm font-semibold font-mono truncate text-foreground">
                {overview?.defaultGateway || 'None'}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                dev {overview?.defaultIface || 'N/A'}
              </div>
            </div>
            <Globe className="h-7 w-7 text-primary/30 shrink-0" />
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => onNavigateTab('connections')}>
          <CardContent className="p-3.5 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground font-medium">{t('net_ov_listening_ports')}</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {overview?.listeningPortsCount ?? 0}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">
                TCP / UDP Ports
              </div>
            </div>
            <Radio className="h-7 w-7 text-primary/30" />
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors cursor-pointer" onClick={() => onNavigateTab('connections')}>
          <CardContent className="p-3.5 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs text-muted-foreground font-medium">{t('net_ov_active_conns')}</div>
              <div className="text-xl font-bold font-mono text-foreground">
                {overview?.establishedConnCount ?? 0}
              </div>
              <div className="text-[10px] text-muted-foreground font-medium">
                ESTABLISHED
              </div>
            </div>
            <Server className="h-7 w-7 text-primary/30" />
          </CardContent>
        </Card>
      </div>

      {/* Main Grid: Interface Cards Grid & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Interfaces List (2 Cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Network className="h-3.5 w-3.5" />
              {t('net_ov_interfaces')}
            </h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground gap-1 hover:text-foreground"
              onClick={() => onNavigateTab('interfaces')}
            >
              <span>{t('net_tab_interfaces')}</span>
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {overview?.interfaces.map((iface: InterfaceInfo) => (
              <Card key={iface.name} className="border shadow-none hover:border-primary/30 transition-all">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-foreground">{iface.name}</span>
                      <Badge
                        variant={iface.state === 'UP' ? 'default' : 'secondary'}
                        className={`text-[9px] px-1.5 py-0 font-mono ${
                          iface.state === 'UP' ? 'bg-green-600 text-white dark:bg-green-500' : ''
                        }`}
                      >
                        {iface.state}
                      </Badge>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      MTU {iface.mtu}
                    </span>
                  </div>

                  <div className="text-[11px] space-y-1">
                    {iface.ipv4.length > 0 ? (
                      <div className="flex items-center gap-1.5 text-foreground font-mono">
                        <span className="text-muted-foreground text-[10px]">IPv4:</span>
                        <span className="truncate">{iface.ipv4.join(', ')}</span>
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted-foreground">No IPv4</div>
                    )}
                    {iface.mac && (
                      <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[10px]">
                        <span>MAC:</span>
                        <span>{iface.mac}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                    <span className="flex items-center gap-1">
                      <ArrowDownUp className="h-2.5 w-2.5" />
                      RX: {formatBytes(iface.rxBytes)}
                    </span>
                    <span>TX: {formatBytes(iface.txBytes)}</span>
                    {(iface.rxErrors > 0 || iface.txErrors > 0) && (
                      <span className="text-red-500 font-semibold">Err: {iface.rxErrors + iface.txErrors}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Right Column: DNS, Capabilities & Recent Runs */}
        <div className="space-y-4">
          {/* DNS Resolvers Card */}
          <Card className="border shadow-none">
            <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                {t('net_ov_dns_servers')}
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[11px] text-muted-foreground"
                onClick={() => onNavigateTab('routes-dns')}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-1.5">
              {overview?.dnsServers && overview.dnsServers.length > 0 ? (
                overview.dnsServers.map((dns: string, i: number) => (
                  <div key={i} className="flex items-center justify-between p-1.5 rounded bg-muted/30 text-xs font-mono">
                    <span>{dns}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">DNS #{i + 1}</Badge>
                  </div>
                ))
              ) : (
                <div className="text-xs text-muted-foreground py-2 text-center">
                  暂无 DNS 服务器信息
                </div>
              )}
            </CardContent>
          </Card>

          {/* Host Capabilities Card */}
          <Card className="border shadow-none">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('net_ov_capabilities')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="flex flex-wrap gap-1.5">
                <CapBadge label="iproute2" available={overview?.capabilities.hasIproute2} />
                <CapBadge label="ss" available={overview?.capabilities.hasSs} />
                <CapBadge label="tcpdump" available={overview?.capabilities.hasTcpdump} />
                <CapBadge label="mtr" available={overview?.capabilities.hasMtr} />
                <CapBadge label="traceroute" available={overview?.capabilities.hasTraceroute} />
                <CapBadge label="ethtool" available={overview?.capabilities.hasEthtool} />
                <CapBadge label="curl" available={overview?.capabilities.hasCurl} />
                <CapBadge label="ICMP" available={overview?.capabilities.canIcmp} />
              </div>
            </CardContent>
          </Card>

          {/* Recent Runs */}
          {overview?.recentRuns && overview.recentRuns.length > 0 && (
            <Card className="border shadow-none">
              <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {t('net_ov_recent_runs')}
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[11px] text-muted-foreground"
                  onClick={() => onNavigateTab('history')}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1.5">
                {overview.recentRuns.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    onClick={() => onNavigateTab('history')}
                    className="flex items-center justify-between p-2 rounded border bg-card/60 hover:bg-accent/40 cursor-pointer text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Activity className={`h-3.5 w-3.5 shrink-0 ${r.status === 'ok' ? 'text-green-500' : 'text-red-500'}`} />
                      <span className="font-mono font-medium truncate">{r.target}</span>
                      {r.port && <span className="text-[10px] text-muted-foreground">:{r.port}</span>}
                    </div>
                    <Badge variant={r.status === 'ok' ? 'outline' : 'destructive'} className="text-[10px] uppercase font-mono px-1 py-0">
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function CapBadge({ label, available }: { label: string; available?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 font-mono ${
        available
          ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
          : 'bg-muted text-muted-foreground border-transparent opacity-50'
      }`}
    >
      {label}
    </Badge>
  )
}
