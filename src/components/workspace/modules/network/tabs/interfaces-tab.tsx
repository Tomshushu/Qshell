import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Network,
  ArrowDownUp,
  AlertCircle,
  Cpu,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { InterfaceInfo, EthtoolInfo } from '@/types/network'
import { EthtoolDrawer } from '../components/ethtool-drawer'
import { sshService } from '@/services/ssh-service'

interface InterfacesTabProps {
  serverId: string
  interfaces: InterfaceInfo[]
  loading: boolean
  onRefresh: () => void
}

export function InterfacesTab({
  serverId,
  interfaces,
}: InterfacesTabProps) {
  const { t } = useTranslation()
  const [selectedEthtool, setSelectedEthtool] = useState<EthtoolInfo | null>(null)
  const [ethtoolOpen, setEthtoolOpen] = useState(false)
  const [fetchingEthtool, setFetchingEthtool] = useState<string | null>(null)

  const handleOpenEthtool = async (ifaceName: string) => {
    setFetchingEthtool(ifaceName)
    try {
      const info = await sshService.getNetworkEthtool(serverId, ifaceName)
      setSelectedEthtool(info)
      setEthtoolOpen(true)
    } catch (err) {
      console.error('Failed to get ethtool:', err)
      setSelectedEthtool({
        iface: ifaceName,
        speed: null,
        duplex: null,
        port: null,
        autoNegotiation: null,
        linkDetected: null,
        driver: null,
      })
      setEthtoolOpen(true)
    } finally {
      setFetchingEthtool(null)
    }
  }

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto p-4 space-y-3">
      <div className="flex items-center justify-between pb-1 border-b">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('net_tab_interfaces')}</h3>
          <span className="text-xs text-muted-foreground">({interfaces.length})</span>
        </div>
      </div>

      {interfaces.length === 0 ? (
        <div className="py-16 text-center text-xs text-muted-foreground">
          <Network className="h-10 w-10 mx-auto mb-2 opacity-30" />
          {t('net_if_no_interfaces')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {interfaces.map((iface) => (
            <Card key={iface.name} className="border shadow-none hover:border-primary/40 transition-all">
              <CardContent className="p-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Left: Name, Badges, Addresses */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {iface.name}
                      </span>
                      <Badge
                        variant={iface.state === 'UP' ? 'default' : 'secondary'}
                        className={`text-[10px] px-2 py-0 font-mono ${
                          iface.state === 'UP' ? 'bg-green-600 text-white dark:bg-green-500' : ''
                        }`}
                      >
                        {iface.state}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                        MTU {iface.mtu}
                      </Badge>
                      {iface.mac && (
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                          MAC: {iface.mac}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono">
                      {iface.ipv4.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-[11px]">IPv4:</span>
                          <span className="text-foreground font-semibold">{iface.ipv4.join(', ')}</span>
                        </div>
                      )}
                      {iface.ipv6.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="text-muted-foreground text-[11px]">IPv6:</span>
                          <span className="text-muted-foreground truncate max-w-xs">{iface.ipv6.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Middle: Traffic stats */}
                  <div className="flex items-center gap-4 text-xs font-mono bg-muted/20 p-2.5 rounded-lg border border-border/40 shrink-0">
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <ArrowDownUp className="h-3 w-3 text-primary" />
                        {t('net_if_rx')}
                      </div>
                      <div className="font-semibold text-foreground">{formatBytes(iface.rxBytes)}</div>
                      <div className="text-[10px] text-muted-foreground">{iface.rxPackets.toLocaleString()} pkts</div>
                    </div>

                    <div className="w-[1px] h-8 bg-border/60" />

                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground">
                        {t('net_if_tx')}
                      </div>
                      <div className="font-semibold text-foreground">{formatBytes(iface.txBytes)}</div>
                      <div className="text-[10px] text-muted-foreground">{iface.txPackets.toLocaleString()} pkts</div>
                    </div>

                    {(iface.rxErrors > 0 || iface.txErrors > 0 || iface.rxDropped > 0 || iface.txDropped > 0) && (
                      <>
                        <div className="w-[1px] h-8 bg-border/60" />
                        <div className="space-y-0.5 text-red-500">
                          <div className="text-[10px] flex items-center gap-1 font-semibold">
                            <AlertCircle className="h-3 w-3" />
                            {t('net_if_errors')}
                          </div>
                          <div>Err: {iface.rxErrors + iface.txErrors}</div>
                          <div className="text-[10px]">Drop: {iface.rxDropped + iface.txDropped}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEthtool(iface.name)}
                      disabled={fetchingEthtool === iface.name}
                      className="h-7 text-xs gap-1 px-2.5"
                    >
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                      {t('net_if_details')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EthtoolDrawer
        info={selectedEthtool}
        open={ethtoolOpen}
        onClose={() => setEthtoolOpen(false)}
      />
    </div>
  )
}
