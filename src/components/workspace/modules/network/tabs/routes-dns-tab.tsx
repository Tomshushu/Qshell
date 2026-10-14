import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Route,
  Globe,
  Compass,
  RefreshCw,
  Share2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { RouteView, DnsConfigInfo, NeighborInfo, RouteGetResult } from '@/types/network'
import { sshService } from '@/services/ssh-service'

interface RoutesDnsTabProps {
  serverId: string
  routeView: RouteView | null
  dnsConfig: DnsConfigInfo | null
  neighbors: NeighborInfo[]
  loading: boolean
  onRefresh: () => void
}

export function RoutesDnsTab({
  serverId,
  routeView,
  dnsConfig,
  neighbors,
  loading,
  onRefresh,
}: RoutesDnsTabProps) {
  const { t } = useTranslation()
  const [testTarget, setTestTarget] = useState('')
  const [testingRoute, setTestingRoute] = useState(false)
  const [routeGetResult, setRouteGetResult] = useState<RouteGetResult | null>(null)
  const [routeGetError, setRouteGetError] = useState<string | null>(null)

  const handleTestRoute = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!testTarget.trim()) return
    setTestingRoute(true)
    setRouteGetResult(null)
    setRouteGetError(null)

    try {
      const res = await sshService.getNetworkRouteGet(serverId, testTarget.trim())
      setRouteGetResult(res)
    } catch (err) {
      setRouteGetError(err instanceof Error ? err.message : '选路测试失败')
    } finally {
      setTestingRoute(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto p-4 space-y-4">
      {/* Route Get Decision Tester Card */}
      <Card className="border bg-card shadow-sm">
        <CardHeader className="p-3.5 pb-2">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Compass className="h-4 w-4 text-primary" />
            {t('net_route_tester')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3.5 pt-0 space-y-3">
          <form onSubmit={handleTestRoute} className="flex items-center gap-2 max-w-lg">
            <Input
              placeholder={t('net_route_test_target_placeholder')}
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
              className="h-8 text-xs font-mono"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!testTarget.trim() || testingRoute}
              className="h-8 text-xs gap-1.5 shrink-0"
            >
              <Compass className={`h-3.5 w-3.5 ${testingRoute ? 'animate-spin' : ''}`} />
              {t('net_route_test_btn')}
            </Button>
          </form>

          {routeGetError && (
            <div className="p-2 rounded bg-red-500/10 text-red-500 text-xs flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{routeGetError}</span>
            </div>
          )}

          {routeGetResult && (
            <div className="p-3 rounded-lg border bg-muted/30 text-xs space-y-2 font-mono">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('net_route_test_result')}: {routeGetResult.destination}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  dev {routeGetResult.iface || 'default'}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">下一跳网关: </span>
                  <span className="text-foreground font-semibold">{routeGetResult.gateway || '直连链路'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('net_route_outbound_dev')}: </span>
                  <span className="text-foreground font-semibold">{routeGetResult.iface}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('net_route_src_ip')}: </span>
                  <span className="text-foreground font-semibold">{routeGetResult.srcIp || '自动'}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Grid: Routes & DNS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Routing Table (2 Cols) */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between pb-1 border-b">
            <div className="flex items-center gap-2">
              <Route className="h-4 w-4 text-primary" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t('net_route_table')}
              </h3>
              <span className="text-xs text-muted-foreground">({routeView?.routes.length || 0})</span>
            </div>
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground text-[11px] font-medium">
                  <th className="py-2 px-3">{t('net_route_destination')}</th>
                  <th className="py-2 px-3">{t('net_route_gateway')}</th>
                  <th className="py-2 px-3">{t('net_route_iface')}</th>
                  <th className="py-2 px-3">{t('net_route_metric')}</th>
                  <th className="py-2 px-3">Scope / Proto</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-[11px]">
                {routeView?.routes.map((r, idx) => (
                  <tr key={idx} className={`hover:bg-muted/30 transition-colors ${r.isDefault ? 'bg-primary/5' : ''}`}>
                    <td className="py-2 px-3 font-semibold text-foreground flex items-center gap-1.5">
                      {r.destination}
                      {r.isDefault && (
                        <Badge variant="default" className="text-[9px] px-1 py-0 bg-primary font-sans">
                          {t('net_route_default_badge')}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {r.gateway || '-'}
                    </td>
                    <td className="py-2 px-3 text-foreground font-semibold">
                      {r.iface}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {r.metric != null ? r.metric : '-'}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground text-[10px]">
                      {r.scope || r.protocol || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: DNS Configuration & ARP / Neighbors */}
        <div className="space-y-4">
          {/* DNS Configuration */}
          <Card className="border shadow-none">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                {t('net_dns_table')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-2.5 text-xs">
              <div>
                <span className="text-[11px] text-muted-foreground font-medium block mb-1">
                  Nameservers ({dnsConfig?.nameservers.length || 0}):
                </span>
                <div className="space-y-1">
                  {dnsConfig?.nameservers.map((ns, idx) => (
                    <div key={idx} className="p-1.5 rounded bg-muted/40 font-mono text-[11px] text-foreground flex items-center justify-between">
                      <span>{ns}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0">#{idx + 1}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              {dnsConfig?.searchDomains && dnsConfig.searchDomains.length > 0 && (
                <div>
                  <span className="text-[11px] text-muted-foreground font-medium block mb-1">
                    {t('net_dns_search_domains')}:
                  </span>
                  <div className="flex flex-wrap gap-1 font-mono text-[10px]">
                    {dnsConfig.searchDomains.map((d, idx) => (
                      <Badge key={idx} variant="secondary" className="px-1.5 py-0">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t text-[11px] text-muted-foreground flex items-center justify-between">
                <span>{t('net_dns_source')}:</span>
                <span className="font-mono text-foreground font-medium">{dnsConfig?.source || '/etc/resolv.conf'}</span>
              </div>
            </CardContent>
          </Card>

          {/* ARP / Neighbors Table */}
          <Card className="border shadow-none">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Share2 className="h-3.5 w-3.5" />
                {t('net_neigh_table')} ({neighbors.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 space-y-1">
              {neighbors.length === 0 ? (
                <div className="text-xs text-muted-foreground py-3 text-center">
                  暂无 ARP / 邻居表记录
                </div>
              ) : (
                <div className="max-h-56 overflow-auto space-y-1">
                  {neighbors.map((n, idx) => (
                    <div key={idx} className="p-2 rounded border bg-card/60 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground">{n.ip}</span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 ${
                            n.state === 'REACHABLE'
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {n.state}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>MAC: {n.mac || 'N/A'}</span>
                        <span>dev: {n.iface}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
