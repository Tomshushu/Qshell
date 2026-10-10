import { useState, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Radio,
  Search,
  RefreshCw,
  ExternalLink,
  Skull,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { ConnPage } from '@/types/network'
import { sshService } from '@/services/ssh-service'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface ConnectionsTabProps {
  serverId: string
  connPage: ConnPage | null
  loading: boolean
  onRefresh: () => void
  onNavigate?: (module: string, context?: { searchQuery?: string; view?: string }) => void
}

function formatEndpoint(address: string, port: number | string): string {
  let addr = (address || '*').replace(/%[a-zA-Z0-9_.-]+$/, '')
  if (addr.includes(':') && !addr.startsWith('[')) {
    addr = `[${addr}]`
  }
  return `${addr}:${port}`
}

export function ConnectionsTab({
  serverId,
  connPage,
  loading,
  onRefresh,
  onNavigate,
}: ConnectionsTabProps) {
  const { t } = useTranslation()
  const [stateFilter, setStateFilter] = useState<'ALL' | 'LISTEN' | 'ESTAB' | 'OTHER'>('ALL')
  const [protoFilter, setProtoFilter] = useState<'ALL' | 'tcp' | 'udp'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [killPid, setKillPid] = useState<number | null>(null)
  const [isKilling, setIsKilling] = useState(false)

  const items = useMemo(() => connPage?.items || [], [connPage?.items])

  const filteredItems = useMemo(() => {
    return items.filter((s) => {
      if (stateFilter !== 'ALL') {
        if (stateFilter === 'LISTEN' && s.state !== 'LISTEN') return false
        if (stateFilter === 'ESTAB' && s.state !== 'ESTAB') return false
        if (stateFilter === 'OTHER' && (s.state === 'LISTEN' || s.state === 'ESTAB')) return false
      }
      if (protoFilter !== 'ALL') {
        if (!s.protocol.toLowerCase().includes(protoFilter)) return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchLocal = s.localAddress.toLowerCase().includes(q) || s.localPort.toString().includes(q)
        const matchForeign = s.foreignAddress.toLowerCase().includes(q) || s.foreignPort.toString().includes(q)
        const matchProc = s.processName?.toLowerCase().includes(q)
        const matchPid = s.pid?.toString().includes(q)
        if (!matchLocal && !matchForeign && !matchProc && !matchPid) return false
      }
      return true
    })
  }, [items, stateFilter, protoFilter, searchQuery])

  const handleConfirmKill = async () => {
    if (!killPid) return
    setIsKilling(true)
    try {
      await sshService.killPortByPid(serverId, killPid)
      setKillPid(null)
      onRefresh()
    } catch (err) {
      console.error('Failed to kill pid:', err)
    } finally {
      setIsKilling(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col overflow-hidden">
      {/* Filter and search toolbar */}
      <div className="p-3 border-b bg-card flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* State Filter Buttons */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
            <button
              onClick={() => setStateFilter('ALL')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stateFilter === 'ALL' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('net_conn_all')} ({items.length})
            </button>
            <button
              onClick={() => setStateFilter('LISTEN')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stateFilter === 'LISTEN' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('net_conn_listening')} ({connPage?.listeningCount ?? 0})
            </button>
            <button
              onClick={() => setStateFilter('ESTAB')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stateFilter === 'ESTAB' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('net_conn_established')} ({connPage?.establishedCount ?? 0})
            </button>
            <button
              onClick={() => setStateFilter('OTHER')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                stateFilter === 'OTHER' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              其他 ({connPage?.otherCount ?? 0})
            </button>
          </div>

          {/* Protocol Filter */}
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
            <button
              onClick={() => setProtoFilter('ALL')}
              className={`px-2 py-1 rounded-md transition-colors ${
                protoFilter === 'ALL' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => setProtoFilter('tcp')}
              className={`px-2 py-1 rounded-md transition-colors uppercase font-mono ${
                protoFilter === 'tcp' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              TCP
            </button>
            <button
              onClick={() => setProtoFilter('udp')}
              className={`px-2 py-1 rounded-md transition-colors uppercase font-mono ${
                protoFilter === 'udp' ? 'bg-background font-semibold shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              UDP
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-sm justify-end">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t('net_conn_search')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs w-full"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-8 text-xs gap-1 shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('net_refresh')}
          </Button>
        </div>
      </div>

      {/* Sockets Table */}
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {filteredItems.length === 0 ? (
          <div className="py-20 text-center text-xs text-muted-foreground">
            <Radio className="h-10 w-10 mx-auto mb-2 opacity-30" />
            {t('net_conn_empty')}
          </div>
        ) : (
          <div className="border rounded-lg bg-card overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/95 backdrop-blur-xs z-10">
                <tr className="border-b border-border/60 text-muted-foreground text-[11px] font-medium">
                  <th className="py-2.5 px-3">{t('net_conn_proto')}</th>
                  <th className="py-2.5 px-3">{t('net_conn_local')}</th>
                  <th className="py-2.5 px-3">{t('net_conn_foreign')}</th>
                  <th className="py-2.5 px-3">{t('net_conn_state')}</th>
                  <th className="py-2.5 px-3">{t('net_conn_pid_proc')}</th>
                  <th className="py-2.5 px-3 text-right">{t('common_action') || '操作'}</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-[11px]">
                {filteredItems.map((s, idx) => (
                  <tr key={idx} className="hover:bg-muted/30 transition-colors">
                    <td className="py-2.5 px-3 font-semibold uppercase text-foreground">
                      {s.protocol}
                    </td>
                    <td className="py-2.5 px-3 text-foreground font-semibold">
                      {formatEndpoint(s.localAddress, s.localPort)}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      {formatEndpoint(s.foreignAddress, s.foreignPort)}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 font-mono tracking-wider ${
                          s.state === 'LISTEN'
                            ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 font-semibold'
                            : s.state === 'ESTAB'
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {s.state}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      {s.processName ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-foreground font-medium">{s.processName}</span>
                          {s.pid != null && (
                            <span className="text-[10px] text-muted-foreground">({s.pid})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">-</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1 font-sans">
                        {s.pid != null && onNavigate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onNavigate('processes', { searchQuery: String(s.pid) })}
                            className="h-6 px-1.5 text-[10px] text-primary gap-1"
                            title={t('net_conn_jump_proc')}
                          >
                            <ExternalLink className="h-3 w-3" />
                            {t('net_conn_jump_proc')}
                          </Button>
                        )}
                        {s.localPort > 0 && onNavigate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onNavigate('ports', { searchQuery: String(s.localPort) })}
                            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                            title="在端口中查看"
                          >
                            端口
                          </Button>
                        )}
                        {s.pid != null && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setKillPid(s.pid!)}
                            className="h-6 px-1.5 text-[10px] text-red-500 hover:bg-red-500/10 gap-1"
                            title={t('net_conn_kill')}
                          >
                            <Skull className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={killPid !== null}
        onOpenChange={(v) => !v && setKillPid(null)}
        title={t('net_conn_kill')}
        description={t('net_conn_kill_confirm').replace('{pid}', String(killPid))}
        confirmText={t('common_confirm') || '确认'}
        cancelText={t('common_cancel') || '取消'}
        variant="destructive"
        onConfirm={handleConfirmKill}
        loading={isKilling}
      />
    </div>
  )
}
