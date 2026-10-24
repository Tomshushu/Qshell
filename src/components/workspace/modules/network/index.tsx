import { useState, useEffect, useCallback } from 'react'
import {
  LayoutDashboard,
  Network,
  Radio,
  Route,
  Activity,
  FileDown,
  History,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { sshService } from '@/services/ssh-service'
import type {
  NetOverview,
  InterfaceInfo,
  RouteView,
  DnsConfigInfo,
  ConnPage,
  NeighborInfo,
  NetworkRunSummary,
} from '@/types/network'
import type { NavigationContext, WorkspaceModule } from '@/types'
import { OverviewTab } from './tabs/overview-tab'
import { InterfacesTab } from './tabs/interfaces-tab'
import { ConnectionsTab } from './tabs/connections-tab'
import { RoutesDnsTab } from './tabs/routes-dns-tab'
import { DiagnosticsTab } from './tabs/diagnostics-tab'
import { CaptureTab } from './tabs/capture-tab'
import { HistoryTab } from './tabs/history-tab'

export type NetworkTabId =
  | 'overview'
  | 'interfaces'
  | 'connections'
  | 'routes-dns'
  | 'diagnostics'
  | 'capture'
  | 'history'

export interface NetworkModuleProps {
  serverId: string
  onNavigate?: (module: WorkspaceModule, context?: NavigationContext) => void
}

export function NetworkModule({ serverId, onNavigate }: NetworkModuleProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<NetworkTabId>('overview')

  // Global facts
  const [overview, setOverview] = useState<NetOverview | null>(null)
  const [interfaces, setInterfaces] = useState<InterfaceInfo[]>([])
  const [routes, setRoutes] = useState<RouteView | null>(null)
  const [dnsConfig, setDnsConfig] = useState<DnsConfigInfo | null>(null)
  const [connPage, setConnPage] = useState<ConnPage | null>(null)
  const [neighbors, setNeighbors] = useState<NeighborInfo[]>([])
  const [runs, setRuns] = useState<NetworkRunSummary[]>([])
  const [loading, setLoading] = useState(false)

  // Quick check transfer
  const [quickCheckTarget, setQuickCheckTarget] = useState('')
  const [quickCheckPort, setQuickCheckPort] = useState(443)

  const fetchAllData = useCallback(async () => {
    if (!serverId) return
    setLoading(true)
    try {
      const [ov, ifaces, rt, dns, conns, neighs, rList] = await Promise.allSettled([
        sshService.getNetworkOverview(serverId),
        sshService.getNetworkInterfaces(serverId),
        sshService.getNetworkRoutes(serverId),
        sshService.getNetworkDnsConfig(serverId),
        sshService.getNetworkConnections(serverId),
        sshService.getNetworkNeighbors(serverId),
        sshService.listNetworkRuns(serverId, 20),
      ])

      if (ov.status === 'fulfilled') setOverview(ov.value)
      if (ifaces.status === 'fulfilled') setInterfaces(ifaces.value)
      if (rt.status === 'fulfilled') setRoutes(rt.value)
      if (dns.status === 'fulfilled') setDnsConfig(dns.value)
      if (conns.status === 'fulfilled') setConnPage(conns.value)
      if (neighs.status === 'fulfilled') setNeighbors(neighs.value)
      if (rList.status === 'fulfilled') setRuns(rList.value)
    } catch (err) {
      console.error('Failed to load network data:', err)
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {

    fetchAllData()
  }, [fetchAllData])

  const handleStartQuickCheck = (target: string, port: number) => {
    setQuickCheckTarget(target)
    setQuickCheckPort(port)
    setActiveTab('diagnostics')
  }

  const tabs: {
    id: NetworkTabId
    label: string
    icon: React.ComponentType<{ className?: string }>
    badge?: number | string | null
  }[] = [
    { id: 'overview', label: t('net_tab_overview'), icon: LayoutDashboard },
    {
      id: 'interfaces',
      label: t('net_tab_interfaces'),
      icon: Network,
      badge: interfaces.length > 0 ? interfaces.length : null,
    },
    {
      id: 'connections',
      label: t('net_tab_connections'),
      icon: Radio,
      badge: connPage?.items ? (connPage.total ?? connPage.items.length) : null,
    },
    { id: 'routes-dns', label: t('net_tab_routes_dns'), icon: Route },
    { id: 'diagnostics', label: t('net_tab_diagnostics'), icon: Activity },
    { id: 'capture', label: t('net_tab_capture'), icon: FileDown },
    {
      id: 'history',
      label: t('net_tab_history'),
      icon: History,
      badge: runs.length > 0 ? runs.length : null,
    },
  ]

  return (
    <div className="flex h-full min-h-0 bg-transparent overflow-hidden">
      {/* 左侧二级导航（对齐 Docker 模块 Portainer 式资源导航风格） */}
      <nav className="w-36 sm:w-40 flex-shrink-0 border-r border-border/60 bg-muted/20 flex flex-col py-2 px-1.5 gap-0.5 overflow-y-auto select-none">
        <div className="px-2 pt-1 pb-2.5 mb-1 border-b border-border/40 flex items-center gap-1.5">
          <Network className="h-4 w-4 text-primary shrink-0" />
          <span className="text-[13px] font-semibold text-foreground truncate">
            {t('module_network')}
          </span>
        </div>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors duration-150 text-left select-none cursor-pointer group',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </div>
              {tab.badge != null && (
                <span
                  className={cn(
                    'ml-1 text-[10.5px] px-1.5 py-0.2 rounded-full font-mono shrink-0',
                    isActive
                      ? 'bg-primary/20 text-primary font-semibold'
                      : 'bg-muted text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 上下文信息条（网关指标 / 全局刷新，样式与 Docker 模块统一） */}
        <div className="flex items-center justify-between gap-2.5 px-4 h-11 border-b border-border/50 bg-muted/20 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {overview?.defaultGateway ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-primary/25 bg-primary/10 text-primary text-[11px] font-medium whitespace-nowrap">
                <Route className="w-3 h-3 shrink-0" />
                <span>网关: {overview.defaultGateway}</span>
                {overview.defaultIface && (
                  <span className="text-[10px] opacity-70 font-mono">({overview.defaultIface})</span>
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-muted-foreground/60" />
                <span>{t('module_network')}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchAllData}
              disabled={loading}
              className="h-7 gap-1 text-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span>{t('net_refresh')}</span>
            </Button>
          </div>
        </div>

        {/* 主功能视图区域 */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {activeTab === 'overview' && (
            <OverviewTab
              overview={overview}
              loading={loading}
              onStartQuickCheck={handleStartQuickCheck}
              onNavigateTab={(tab) => setActiveTab(tab as NetworkTabId)}
            />
          )}
          {activeTab === 'interfaces' && (
            <InterfacesTab
              serverId={serverId}
              interfaces={interfaces}
              loading={loading}
              onRefresh={fetchAllData}
            />
          )}
          {activeTab === 'connections' && (
            <ConnectionsTab
              serverId={serverId}
              connPage={connPage}
              loading={loading}
              onRefresh={fetchAllData}
              onNavigate={onNavigate}
            />
          )}
          {activeTab === 'routes-dns' && (
            <RoutesDnsTab
              serverId={serverId}
              routeView={routes}
              dnsConfig={dnsConfig}
              neighbors={neighbors}
              loading={loading}
              onRefresh={fetchAllData}
            />
          )}
          {activeTab === 'diagnostics' && (
            <DiagnosticsTab
              serverId={serverId}
              initialTarget={quickCheckTarget}
              initialPort={quickCheckPort}
            />
          )}
          {activeTab === 'capture' && (
            <CaptureTab
              serverId={serverId}
              interfaces={interfaces}
            />
          )}
          {activeTab === 'history' && (
            <HistoryTab
              serverId={serverId}
              runs={runs}
              loading={loading}
              onRefresh={fetchAllData}
            />
          )}
        </div>
      </div>
    </div>
  )
}
