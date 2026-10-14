import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RefreshCw, Search, Skull, ArrowLeftRight, Network } from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import type { PortInfo } from '@/types'
import { cn } from '@/lib/utils'
import { PortForwardModule } from './port-forward'

export type PortSubTab = 'listening' | 'forward'

interface PortsModuleProps {
  serverId: string
  initialSearchQuery?: string
  initialSubTab?: PortSubTab
}

export function PortsModule({ serverId, initialSearchQuery, initialSubTab = 'listening' }: PortsModuleProps) {
  const { t } = useTranslation()
  const [activeSubTab, setActiveSubTab] = useState<PortSubTab>(initialSubTab)
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '')
  const [prevInitialSearchQuery, setPrevInitialSearchQuery] = useState(initialSearchQuery)
  if (initialSearchQuery !== prevInitialSearchQuery) {
    setPrevInitialSearchQuery(initialSearchQuery)
    setSearchQuery(initialSearchQuery || '')
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPort, setExpandedPort] = useState<number | null>(null)
  const [killingPid, setKillingPid] = useState<number | null>(null)

  const fetchPorts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await sshService.listPorts(serverId)
      setPorts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prts_err_load'))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  useEffect(() => {

    fetchPorts()
  }, [fetchPorts])

  const handleKillByPid = async (pid: number) => {
    setKillingPid(pid)
    try {
      const result = await sshService.killPortByPid(serverId, pid)
      if (result.exitCode !== 0) {
        setError(t('prts_err_kill').replace('{pid}', String(pid)) + ': ' + (result.stderr || t('common_unknown_error')))
      } else {
        await fetchPorts()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('prts_err_kill_generic'))
    } finally {
      setKillingPid(null)
    }
  }

  const filteredPorts = ports.filter((p) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      p.port.toString().includes(q) ||
      p.processName.toLowerCase().includes(q) ||
      p.protocol.toLowerCase().includes(q) ||
      (p.pid != null && p.pid.toString().includes(q))
    )
  })

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* 统一规范工具栏 */}
      <div className="flex items-center justify-between gap-3 px-4 h-11 border-b border-border/50 bg-muted/20 shrink-0">
        {/* 子模块切换 Segmented Tabs */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50 text-xs">
          <button
            type="button"
            onClick={() => setActiveSubTab('listening')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer select-none text-[11px]",
              activeSubTab === 'listening'
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Network className="h-3.5 w-3.5" />
            <span>{t('prts_tab_listening')}</span>
            {ports.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold">
                {ports.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('forward')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all cursor-pointer select-none text-[11px]",
              activeSubTab === 'forward'
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span>{t('prts_tab_forward')}</span>
          </button>
        </div>

        {/* 仅在系统监听模式下显示右侧刷新与搜索 */}
        {activeSubTab === 'listening' && (
          <div className="flex items-center gap-2">
            <Button onClick={fetchPorts} disabled={loading} size="sm" variant="ghost" className="gap-1 h-7 text-xs">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('prts_refresh')}
            </Button>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t('prts_search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-7 pl-8 text-xs bg-background/80"
              />
            </div>
          </div>
        )}
      </div>

      {activeSubTab === 'listening' ? (
        <>
          {/* Error message */}
          {error && (
            <div className="px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs border-b border-rose-500/20 flex items-center justify-between">
              <span>{error}</span>
              <Button variant="ghost" size="sm" className="h-4 text-[10px] ml-2" onClick={() => setError(null)}>{t('prts_close')}</Button>
            </div>
          )}

          {/* Port table */}
          <div className="flex-1 overflow-auto">
            {loading && ports.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm">{t('prts_loading')}</span>
              </div>
            ) : ports.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">{t('prts_empty')}</p>
              </div>
            ) : (
              <div className="p-3">
                <div className="rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
                  <table className="w-full text-xs">
                  <thead className="workspace-table-head">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t('prts_th_proto')}</th>
                      <th className="px-3 py-2 font-medium">{t('prts_th_addr')}</th>
                      <th className="px-3 py-2 font-medium">{t('prts_th_port')}</th>
                      <th className="px-3 py-2 font-medium">{t('prts_th_process')}</th>
                      <th className="px-3 py-2 font-medium">PID</th>
                      <th className="px-3 py-2 font-medium">{t('prts_th_status')}</th>
                      <th className="px-3 py-2 font-medium">{t('prts_th_action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPorts.map((port, i) => (
                      <tr key={`${port.protocol}-${port.port}-${i}`} className="border-b hover:bg-accent/30 cursor-pointer" onClick={() => setExpandedPort(expandedPort === i ? null : i)}>
                        <td className="px-3 py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${port.protocol === 'tcp' ? 'bg-blue-500/10 text-blue-500' : 'bg-purple-500/10 text-purple-500'}`}>
                            {port.protocol.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{port.localAddress}</td>
                        <td className="px-3 py-1.5 font-mono font-medium text-primary">{port.port}</td>
                        <td className="px-3 py-1.5">{port.processName}</td>
                        <td className="px-3 py-1.5 font-mono">{port.pid}</td>
                        <td className="px-3 py-1.5">
                          {port.state && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500">
                              {port.state}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={t('prts_kill')}
                            disabled={killingPid === port.pid}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleKillByPid(port.pid)
                            }}
                          >
                            <Skull className="h-3 w-3 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {filteredPorts.length === 0 && ports.length > 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Search className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">{t('prts_no_match')}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          <PortForwardModule serverId={serverId} hideToolbarHeader={true} />
        </div>
      )}
    </div>
  )
}
