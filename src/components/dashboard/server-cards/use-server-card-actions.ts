import { useState, useRef, useCallback, useEffect } from 'react'
import type { Server as ServerType } from '@/types'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { playSound, SoundType } from '@/lib/sound'
import { friendlyError } from '@/lib/error-messages'
import { sshService } from '@/services/ssh-service'
import { backend } from '@/services/api'
import { resolveServerOpenAction } from '@/services/connection-targets'

export function useServerCardActions({
  server,
  onSelect,
}: {
  server: ServerType
  onSelect: (serverId: string, ctrlKey: boolean) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const openTab = useAppStore(s => s.openTab)
  const updateServer = useAppStore(s => s.updateServer)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopyIp = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(server.host)
      setCopied(true)
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
      playSound(SoundType.Click)
    } catch (e) {
      toast.error(`${t('common_copy_failed')}: ${(e as Error).message || e}`)
    }
  }, [server.host, toast, t])

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

  const handleToggleFavorite = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const newFav = !server.favorite
    try {
      await sshService.updateServer(server.id, { favorite: newFav })
      updateServer(server.id, { favorite: newFav })
      playSound(SoundType.Toggle)
    } catch (e) {
      toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
    }
  }, [server.id, server.favorite, updateServer, toast, t])

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(server.id, e.ctrlKey || e.metaKey)
  }, [server.id, onSelect])

  const lastDoubleClickTimeRef = useRef(0)
  const handleDoubleClick = useCallback(() => {
    const now = Date.now()
    if (now - lastDoubleClickTimeRef.current < 600) return
    lastDoubleClickTimeRef.current = now

    // Phase 1-B：分派规则统一由能力表解析，protocols 声明参与判断
    const action = resolveServerOpenAction(server)
    if (action === 'terminal') {
      openTab(server.id, server.name, 'terminal')
    } else if (action === 'bmc') {
      // BMC 双击默认进入带外管理界面（Redfish，不依赖 SSH）
      openTab(server.id, server.name, 'bmc')
    } else if (action === 'rdp') {
      void (async () => {
        try {
          const result = await backend?.rdp.launch({ serverId: server.id, rdpPort: server.rdpPort })
          if (!result?.success) {
            toast.error(friendlyError(result?.error || '').message || t('err_generic_conn_failed'))
          }
        } catch (e) {
          const raw = e instanceof Error ? e.message : String(e)
          toast.error(friendlyError(raw).message || t('err_generic_conn_failed'))
        }
      })()
    } else {
      toast.warning(t('server_no_port') || '未配置连接端口')
    }
  }, [server.id, server.name, server.targetType, server.protocol, server.protocols, server.port, server.rdpPort, openTab, toast, t])

  return {
    t,
    copied,
    handleCopyIp,
    handleToggleFavorite,
    handleClick,
    handleDoubleClick,
  }
}
