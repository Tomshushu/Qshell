import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store'
import { sshService } from '@/services/ssh-service'
import { useToast } from '@/components/ui/toast'
import {
  Loader2,
  Server,
  Search,
  ChevronRight,
  ChevronsRight,
  ChevronsLeft,
  ShieldCheck,
  X,
  Award,
} from 'lucide-react'
import type { SshKey, Server as ServerType } from '@/types'
import { OsIcon } from '@/pages/dashboard'

/** 脱敏显示私钥路径（仅保留根/盘符 + 文件名） */
function maskPrivateKeyPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  const filename = parts[parts.length - 1]
  if (path.startsWith('/')) return `/…/${filename}`
  if (/^[A-Za-z]:[\\/]/.test(path)) return `${parts[0]}\\…\\${filename}`
  return `…/${filename}`
}

interface AssociateKeyServersDialogProps {
  open: boolean
  sshKey: SshKey | null
  onClose: () => void
}

export function AssociateKeyServersDialog({ open, sshKey, onClose }: AssociateKeyServersDialogProps) {
  const { toast } = useToast()
  const { servers, updateServer } = useAppStore()

  // 记录当前右栏（已关联）的服务器 ID 集合
  const [associatedIds, setAssociatedIds] = useState<Set<string>>(new Set())
  const [leftSearch, setLeftSearch] = useState('')
  const [rightSearch, setRightSearch] = useState('')
  const [saving, setSaving] = useState(false)

  // 每次打开弹窗或切换密钥时，从 store 中初始化已关联服务器 ID
  // 采用会话特征驱动模式，兼容条件挂载与外部 key 切换，避免在 effect 中同步 setState 触发级联渲染
  const sessionKey = open && sshKey ? `${sshKey.id}:${sshKey.updatedAt ?? ''}` : ''
  const [prevSessionKey, setPrevSessionKey] = useState('')
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    if (open && sshKey) {
      const isCertKey = sshKey.keyType === 'certificate' || (!sshKey.keyType && !!sshKey.certificatePath)
      const initial = new Set(
        servers
          .filter(
            (s) =>
              (isCertKey ? s.authType === 'certificate' : s.authType === 'privateKey') &&
              (s.sshKeyId === sshKey.id || (!!sshKey.privateKeyPath && s.privateKeyPath === sshKey.privateKeyPath))
          )
          .map((s) => s.id)
      )
      setAssociatedIds(initial)
      setLeftSearch('')
      setRightSearch('')
    }
  }

  // 分流：未关联列表 & 已关联列表（排除非 SSH 目标，如串口和带外管理）
  const unassociatedServers = useMemo(() => {
    return servers.filter(
      (s) =>
        !associatedIds.has(s.id) &&
        s.targetType !== 'serial' &&
        s.protocol !== 'serial' &&
        s.targetType !== 'bmc'
    )
  }, [servers, associatedIds])

  const associatedServers = useMemo(() => {
    return servers.filter((s) => associatedIds.has(s.id))
  }, [servers, associatedIds])

  // 左侧（未关联）搜索过滤
  const filteredUnassociated = useMemo(() => {
    if (!leftSearch.trim()) return unassociatedServers
    const q = leftSearch.trim().toLowerCase()
    return unassociatedServers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [unassociatedServers, leftSearch])

  // 右侧（已关联）搜索过滤
  const filteredAssociated = useMemo(() => {
    if (!rightSearch.trim()) return associatedServers
    const q = rightSearch.trim().toLowerCase()
    return associatedServers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [associatedServers, rightSearch])

  if (!open || !sshKey) return null

  // 移动单个服务器到右侧（关联）
  const handleAssociateOne = (id: string) => {
    setAssociatedIds((prev) => new Set([...prev, id]))
  }

  // 移动单个服务器到左侧（取消关联）
  const handleDisassociateOne = (id: string) => {
    setAssociatedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // 全部移到右侧（全部关联）
  const handleAssociateAll = () => {
    const next = new Set(associatedIds)
    filteredUnassociated.forEach((s) => next.add(s.id))
    setAssociatedIds(next)
  }

  // 全部移到左侧（全部取消关联）
  const handleDisassociateAll = () => {
    const next = new Set(associatedIds)
    filteredAssociated.forEach((s) => next.delete(s.id))
    setAssociatedIds(next)
  }

  const handleSave = async () => {
    setSaving(true)
    let updatedCount = 0
    let unassociatedCount = 0
    try {
      const isCertKey = sshKey.keyType === 'certificate' || (!sshKey.keyType && !!sshKey.certificatePath)
      const expectedAuthType = isCertKey ? 'certificate' : 'privateKey'
      for (const server of servers) {
        const isCurrentlyUsingKey =
          server.authType === expectedAuthType && server.privateKeyPath === sshKey.privateKeyPath
        const isNowAssociated = associatedIds.has(server.id)

        if (isNowAssociated && !isCurrentlyUsingKey) {
          // 关联该密钥到服务器：复制私钥路径与证书路径。
          // 注意：passphrase 不在此处复制——后端 list 返回的是 ••••• 占位符，
          // 真实值已加密存储在 ssh_keys 表中。连接时后端会通过 key id 加载
          // 真实 passphrase（阶段 3 content-based 连接），无需服务器表冗余存储。
          // 证书型密钥额外复制 certificatePath 并切换为 certificate 认证。
          const updates: Partial<ServerType> = {
            authType: expectedAuthType,
            privateKeyPath: sshKey.privateKeyPath,
            // 阶段 3：记录关联的 sshKeyId，content-based 连接时后端通过此 id 加载解密内容
            sshKeyId: sshKey.id,
            ...(isCertKey ? { certificatePath: sshKey.certificatePath } : {}),
          }
          await sshService.updateServer(server.id, updates)
          updateServer(server.id, updates)
          updatedCount++
        } else if (!isNowAssociated && isCurrentlyUsingKey) {
          // 取消关联：清空私钥路径、passphrase、sshKeyId（以及证书路径），不静默切换 authType。
          // 保留原 authType 但清空凭据，用户需在编辑对话框中重新配置。
          const updates: Partial<ServerType> = {
            privateKeyPath: '',
            privateKeyPassphrase: '',
            sshKeyId: '',
            ...(isCertKey ? { certificatePath: '' } : {}),
          }
          await sshService.updateServer(server.id, updates)
          updateServer(server.id, updates)
          updatedCount++
          unassociatedCount++
        }
      }

      if (unassociatedCount > 0) {
        toast.success(
          `已更新 ${updatedCount} 台服务器。其中 ${unassociatedCount} 台已取消关联，请前往服务器编辑页重新配置认证方式。`
        )
      } else {
        toast.success(`关联保存成功！共更新 ${updatedCount} 台服务器`)
      }
      onClose()
    } catch (err: unknown) {
      toast.error(`保存失败: ${(err as Error).message || err}`)
    } finally {
      setSaving(false)
    }
  }

  // 判断密钥类型：优先用显式 keyType 字段，回退推断（兼容旧数据）
  const isCertKey = sshKey?.keyType === 'certificate' || (!sshKey?.keyType && !!sshKey?.certificatePath)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <div
        className="bg-card border border-border/60 rounded-2xl shadow-2xl w-[min(820px,calc(100vw-2rem))] max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in-50 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-border/40 flex items-center justify-between bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
              isCertKey
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-primary/10 text-primary'
            }`}>
              {isCertKey ? <Award className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-foreground flex items-center gap-2 truncate">
                关联服务器 — {sshKey.name}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                  isCertKey
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    : 'bg-primary/10 text-primary border border-primary/20'
                }`}>
                  {isCertKey ? '证书' : '私钥'}
                </span>
              </h2>
              <p className="text-xs text-muted-foreground truncate font-mono" title={sshKey.privateKeyPath}>
                {maskPrivateKeyPath(sshKey.privateKeyPath)}
              </p>
              {isCertKey && sshKey.certificatePath && (
                <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 truncate font-mono" title={sshKey.certificatePath}>
                  🏅 {maskPrivateKeyPath(sshKey.certificatePath)}
                </p>
              )}
            </div>
          </div>

          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-lg text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 穿梭框双栏容器 */}
        <div className="p-6 flex-1 grid grid-cols-2 gap-6 overflow-hidden bg-muted/10 min-h-[420px]">
          {/* 左栏：未关联服务器 */}
          <div className="bg-card border border-border/50 rounded-xl flex flex-col overflow-hidden shadow-xs">
            {/* 左栏 Header */}
            <div className="p-3 bg-muted/30 border-b border-border/40 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                未关联服务器 ({unassociatedServers.length})
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAssociateAll}
                disabled={filteredUnassociated.length === 0}
                className="h-6 px-2 text-[11px] gap-1 text-primary hover:bg-primary/10 cursor-pointer rounded-lg shrink-0"
                title="将左侧所有匹配的服务器移入右侧"
              >
                全关联 <ChevronsRight className="h-3 w-3" />
              </Button>
            </div>

            {/* 左栏 Search */}
            <div className="p-2 border-b border-border/30 bg-background/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder="搜索未关联服务器..."
                  className="h-7.5 pl-8 pr-3 text-xs bg-muted/20 border-border/40 rounded-lg"
                />
              </div>
            </div>

            {/* 左栏 列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[280px] max-h-[320px]">
              {filteredUnassociated.length > 0 ? (
                filteredUnassociated.map((server) => (
                  <div
                    key={server.id}
                    onClick={() => handleAssociateOne(server.id)}
                    className="group flex items-center justify-between p-2 rounded-lg border border-border/30 hover:border-primary/40 bg-card hover:bg-primary/5 transition-all cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <OsIcon osType={server.osType} targetType={server.targetType} className="h-6 w-6 rounded-md shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-foreground truncate">{server.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {server.username}@{server.host}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAssociateOne(server.id)
                      }}
                      className="h-6 px-2 text-[11px] gap-1 text-primary group-hover:bg-primary group-hover:text-primary-foreground rounded-md shrink-0 transition-all"
                    >
                      关联 <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {leftSearch ? '无匹配未关联服务器' : '暂无未关联的服务器'}
                </div>
              )}
            </div>
          </div>

          {/* 右栏：已关联服务器 */}
          <div className="bg-card border border-primary/30 rounded-xl flex flex-col overflow-hidden shadow-xs">
            {/* 右栏 Header */}
            <div className="p-3 bg-primary/10 border-b border-primary/20 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                已关联服务器 ({associatedServers.length})
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisassociateAll}
                disabled={filteredAssociated.length === 0}
                className="h-6 px-2 text-[11px] gap-1 text-destructive hover:bg-destructive/10 cursor-pointer rounded-lg shrink-0"
                title="取消右侧所有匹配服务器的关联"
              >
                <ChevronsLeft className="h-3 w-3" /> 清空关联
              </Button>
            </div>

            {/* 右栏 Search */}
            <div className="p-2 border-b border-border/30 bg-background/50">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
                <Input
                  value={rightSearch}
                  onChange={(e) => setRightSearch(e.target.value)}
                  placeholder="搜索已关联服务器..."
                  className="h-7.5 pl-8 pr-3 text-xs bg-muted/20 border-border/40 rounded-lg"
                />
              </div>
            </div>

            {/* 右栏 列表 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[280px] max-h-[320px]">
              {filteredAssociated.length > 0 ? (
                filteredAssociated.map((server) => (
                  <div
                    key={server.id}
                    onClick={() => handleDisassociateOne(server.id)}
                    className="group flex items-center justify-between p-2 rounded-lg border border-primary/20 bg-primary/5 hover:border-destructive/40 hover:bg-destructive/5 transition-all cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <OsIcon osType={server.osType} targetType={server.targetType} className="h-6 w-6 rounded-md shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-foreground truncate">{server.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {server.username}@{server.host}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDisassociateOne(server.id)
                      }}
                      className="h-6 px-2 text-[11px] gap-1 text-muted-foreground group-hover:bg-destructive group-hover:text-white rounded-md shrink-0 transition-all"
                    >
                      <X className="h-3 w-3" /> 取消关联
                    </Button>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  {rightSearch ? '无匹配已关联服务器' : '尚未关联任何服务器'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-border/40 flex items-center justify-between bg-card">
          <div className="text-xs text-muted-foreground">
            将为 <strong className="text-primary font-bold">{associatedServers.length}</strong> 台服务器关联此 SSH 密钥
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-8 text-xs min-w-[100px] rounded-xl bg-primary text-primary-foreground font-semibold shadow-sm hover:shadow-md cursor-pointer"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              保存关联设置
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
