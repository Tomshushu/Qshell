import { useState, useRef, useCallback, useEffect } from 'react'
import type { Server as ServerType } from '@/types'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { playSound, SoundType } from '@/lib/sound'
import { sshService } from '@/services/ssh-service'
import { backend } from '@/services/api'

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

    // Windows 优先 SSH 终端，仅配 RDP 启远程桌面，皆无提示未配置连接端口
    if (server.targetType === 'windows') {
      const hasSsh = Boolean(server.port && server.port > 0)
      const hasRdp = Boolean(server.rdpPort && server.rdpPort > 0)
      if (hasSsh) {
        openTab(server.id, server.name, 'terminal')
      } else if (hasRdp) {
        backend?.rdp.launch({ serverId: server.id, rdpPort: server.rdpPort })
      } else {
        toast.warning(t('server_no_port') || '未配置连接端口')
      }
    } else if (server.targetType === 'bmc') {
      // BMC 双击默认进入带外管理界面（Redfish，不依赖 SSH）
      openTab(server.id, server.name, 'bmc')
    } else {
      // Linux/Unix 双击默认进入终端界面（核心功能优先）
      openTab(server.id, server.name, 'terminal')
    }
  }, [server.id, server.name, server.targetType, server.port, server.rdpPort, openTab, toast, t])

  return {
    t,
    copied,
    handleCopyIp,
    handleToggleFavorite,
    handleClick,
    handleDoubleClick,
  }
}
