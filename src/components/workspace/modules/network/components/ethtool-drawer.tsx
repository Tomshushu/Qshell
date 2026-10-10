import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Network, Activity, Cpu, Layers } from 'lucide-react'
import type { EthtoolInfo } from '@/types/network'
import { useTranslation } from '@/i18n'

interface EthtoolDrawerProps {
  info: EthtoolInfo | null
  open: boolean
  onClose: () => void
}

export function EthtoolDrawer({ info, open, onClose }: EthtoolDrawerProps) {
  const { t } = useTranslation()

  if (!info) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Network className="h-5 w-5 text-primary" />
            <span>{t('net_if_details')}: {info.iface}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2 text-xs">
          <div className="p-3 rounded-lg border bg-muted/30 flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <Activity className="h-3.5 w-3.5 text-primary" />
              {t('net_if_speed')}
            </span>
            <div className="flex items-center gap-1.5 mt-1 font-mono text-sm font-semibold">
              {info.speed || 'N/A'}
              {info.duplex && (
                <Badge variant="outline" className="text-[10px] uppercase px-1.5 py-0">
                  {info.duplex}
                </Badge>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
              <Layers className="h-3.5 w-3.5 text-primary" />
              链路状态
            </span>
            <div className="mt-1">
              {info.linkDetected != null ? (
                <Badge className={info.linkDetected ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"}>
                  {info.linkDetected ? "已连接" : "未连接"}
                </Badge>
              ) : (
                <span className="text-muted-foreground">未知</span>
              )}
            </div>
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 flex flex-col gap-1">
            <span className="text-muted-foreground font-medium">自协商</span>
            <span className="font-mono text-xs mt-1 text-foreground">
              {info.autoNegotiation || 'N/A'}
            </span>
          </div>

          <div className="p-3 rounded-lg border bg-muted/30 flex flex-col gap-1">
            <span className="text-muted-foreground font-medium">端口类型</span>
            <span className="font-mono text-xs mt-1 text-foreground">
              {info.port || 'N/A'}
            </span>
          </div>

          {info.driver && (
            <div className="col-span-2 p-3 rounded-lg border bg-muted/30 flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                <Cpu className="h-3.5 w-3.5 text-primary" />
                网卡驱动
              </span>
              <span className="font-mono font-semibold text-foreground">
                {info.driver}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
